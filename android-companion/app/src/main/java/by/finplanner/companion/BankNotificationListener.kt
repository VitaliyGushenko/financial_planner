package by.finplanner.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Слушает уведомления выбранных банков, разбирает текст и пишет операцию в Firestore.
 * Работает без Google Play Services: только HTTPS и REST.
 */
class BankNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) {
            return
        }
        val prefs = Prefs(applicationContext)
        val pkg = sbn.packageName ?: return
        if (sbn.isOngoing || !prefs.selectedPackages.contains(pkg)) {
            return
        }

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString(" ").orEmpty()
        val body = listOf(big, text, lines).maxByOrNull { it.length }.orEmpty()
        val full = listOf(title, body).filter { it.isNotBlank() }.joinToString(" ").trim()
        if (full.isBlank()) {
            return
        }

        val postedAt = sbn.postTime
        Thread {
            try {
                handle(prefs, pkg, full, postedAt)
            } catch (error: Exception) {
                prefs.log("Ошибка обработки: ${error.message}")
            }
        }.start()
    }

    private fun handle(prefs: Prefs, pkg: String, full: String, postedAt: Long) {
        val uid = prefs.uid
        if (uid.isNullOrBlank() || prefs.refreshToken.isNullOrBlank()) {
            prefs.log("Пропуск: не выполнен вход")
            return
        }
        val auth = AuthApi(prefs)
        val token = auth.token()
        if (token.isNullOrBlank()) {
            prefs.log("Пропуск: токен не получен, войдите заново")
            return
        }
        val api = FirestoreApi(auth)

        val parsed = BankParser.parse(full)
        if (parsed == null) {
            if (BankParser.looksLikeBank(full)) {
                api.addInbox(uid, pkg, full, "unparsed")
                prefs.log("Не распознано — во входящие")
            }
            return
        }

        val accounts = api.accounts(uid, token)
        val byMask = accounts.firstOrNull { it.cardMask != null && it.cardMask == parsed.cardMask }
        val defaultId = api.defaultAccountId(uid, token)
        val account = byMask
            ?: accounts.firstOrNull { it.id == defaultId }
            ?: accounts.singleOrNull { it.type == "card" }
        if (account == null) {
            api.addInbox(uid, pkg, full, "no-account")
            prefs.log("Нет счёта: маска *${parsed.cardMask ?: "?"} не найдена, основной счёт не выбран")
            return
        }

        val rules = api.rules(uid, token)
        val rule = RulePicker.pick(rules, full, parsed.kind)

        val dateKey = parsed.dateKey
            ?: SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(postedAt))
        val timeIso = parsed.timeIso ?: isoUtc(postedAt)
        val docId = sha1("$pkg|$postedAt|$full")
        val delta = if (parsed.kind == "income") parsed.amount else -parsed.amount

        val tx = FirestoreApi.NewTransaction(
            kind = parsed.kind,
            amount = parsed.amount,
            accountId = account.id,
            categoryId = rule?.categoryId,
            subcategoryId = rule?.subcategoryId,
            dateKey = dateKey,
            timeIso = timeIso,
            merchant = parsed.merchant,
            cardMask = parsed.cardMask,
            rawText = full,
            balanceDelta = delta,
        )

        val result = api.createTransaction(uid, docId, tx, accountExists = true)
        val duplicate = result.code == 409 ||
            (result.code == 400 && (result.body.contains("ALREADY_EXISTS") || result.body.contains("FAILED_PRECONDITION")))
        when {
            result.code in 200..299 -> {
                val sign = if (parsed.kind == "income") "+" else "−"
                val merchant = parsed.merchant ?: "банк"
                val category = rule?.categoryId ?: "без категории"
                prefs.log("Добавлено: $sign${money(parsed.amount)} · $merchant · $category")
            }
            duplicate -> prefs.log("Дубль пропущен")
            else -> {
                prefs.log("Ошибка записи: ${result.code}")
                api.addInbox(uid, pkg, full, "error")
            }
        }
    }

    private fun money(value: Double): String = String.format(Locale.US, "%.2f", value)

    private fun isoUtc(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(millis))

    private fun sha1(value: String): String =
        MessageDigest.getInstance("SHA-1")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
