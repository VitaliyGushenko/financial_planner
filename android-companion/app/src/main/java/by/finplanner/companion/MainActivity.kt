package by.finplanner.companion

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * Единственный экран: вход, доступ к уведомлениям, выбор банков, проверка, обновления, журнал.
 * UI собирается кодом, чтобы не тянуть внешние зависимости (Material и т.п.).
 */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var auth: AuthApi
    private lateinit var content: LinearLayout
    private lateinit var updater: Updater

    /** Найденное обновление и состояние загрузки. */
    private var update: Updater.Release? = null
    private var updateStatus: String? = null
    private var checkingUpdates = false
    private var downloadingUpdate = false
    private var autoCheckStarted = false
    private var downloadedFile: File? = null
    private var progressLabel: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        auth = AuthApi(prefs)
        updater = Updater(this, prefs)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(color(R.color.bg))
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(32))
        }
        scroll.addView(content)
        setContentView(scroll)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::content.isInitialized) {
            render()
            autoCheckForUpdates()
        }
    }

    private fun render() {
        content.removeAllViews()
        addHeader()

        val signedIn = !prefs.refreshToken.isNullOrBlank() && !prefs.uid.isNullOrBlank()
        if (!signedIn) {
            addLoginCard()
        } else {
            addAccountCard()
            addAccessCard()
            addBanksCard()
            addCheckCard()
        }
        addUpdateCard()
        addLogCard()
        addFooter()
    }

    // ---------- Шапка ----------

    private fun addHeader() {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_header)
            setPadding(dp(18), dp(18), dp(18), dp(18))
            layoutParams = blockParams(bottom = 14)
            elevation = dp(2).toFloat()
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.ic_bell)
                layoutParams = LinearLayout.LayoutParams(dp(24), dp(24))
            }
        )

        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(
            TextView(this).apply {
                text = "Планировщик"
                textSize = 20f
                setTextColor(Color.WHITE)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }
        )
        titles.addView(
            TextView(this).apply {
                text = "банк-компаньон"
                textSize = 12f
                setTextColor(0xCCFFFFFF.toInt())
            }
        )
        row.addView(
            titles,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                .apply { leftMargin = dp(10) }
        )
        row.addView(versionBadge())
        header.addView(row)

        header.addView(
            TextView(this).apply {
                text = "Траты из уведомлений банка сразу попадают в ваш финансовый план."
                textSize = 12.5f
                setTextColor(0xD9FFFFFF.toInt())
                setLineSpacing(dp(2).toFloat(), 1f)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(12) }
            }
        )
        content.addView(header)
    }

    private fun versionBadge(): TextView = TextView(this).apply {
        text = "v${updater.currentVersion()}"
        textSize = 12f
        setTextColor(Color.WHITE)
        setBackgroundResource(R.drawable.bg_badge)
        setPadding(dp(10), dp(4), dp(10), dp(4))
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    // ---------- Вход и аккаунт ----------

    private fun addLoginCard() {
        val card = card("Вход")
        card.addView(hint("Тот же email и пароль, что и в веб-приложении."))

        val email = field("Email", prefs.email ?: "", InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = field("Пароль", "", InputType.TYPE_TEXT_VARIATION_PASSWORD)
        card.addView(email)
        card.addView(password)

        val signIn = primaryButton("Войти")
        signIn.setOnClickListener {
            val mail = email.text.toString().trim()
            val pass = password.text.toString()
            if (mail.isBlank() || pass.isBlank()) {
                toast("Введите email и пароль")
                return@setOnClickListener
            }
            signIn.isEnabled = false
            signIn.alpha = 0.6f
            signIn.text = "Вход…"
            Thread {
                val uid = auth.signIn(mail, pass)
                runOnUiThread {
                    if (uid == null) {
                        toast("Не удалось войти. Проверьте email, пароль и интернет.")
                    } else {
                        prefs.log("Вход выполнен: $mail")
                    }
                    render()
                }
            }.start()
        }
        card.addView(signIn)
        content.addView(card)
    }

    private fun addAccountCard() {
        val card = card("Аккаунт")
        card.addView(
            TextView(this).apply {
                text = prefs.email ?: "—"
                textSize = 15f
                setTextColor(color(R.color.text))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(8) }
            }
        )
        val signOut = secondaryButton("Выйти")
        signOut.setOnClickListener {
            auth.signOut()
            prefs.log("Выход из аккаунта")
            render()
        }
        card.addView(signOut)
        content.addView(card)
    }

    // ---------- Доступ и банки ----------

    private fun addAccessCard() {
        val enabled = isListenerEnabled()
        val card = card("Доступ к уведомлениям")
        card.addView(pill(if (enabled) "Работает" else "Не выдан", enabled))
        card.addView(
            hint(
                if (enabled) "Приложение слушает уведомления выбранных банков."
                else "Без этого доступа операции не будут приходить."
            )
        )
        val open = if (enabled) secondaryButton("Настроить доступ")
        else primaryButton("Открыть настройки доступа")
        open.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (error: Exception) {
                toast("Не удалось открыть настройки: ${error.message}")
            }
        }
        card.addView(open)
        content.addView(card)
    }

    private fun addBanksCard() {
        val selected = prefs.selectedPackages
        val card = card("Приложения банков")
        card.addView(
            pill(
                if (selected.isEmpty()) "Не выбрано" else "Выбрано: ${selected.size}",
                selected.isNotEmpty()
            )
        )
        card.addView(hint("Выберите приложения, чьи уведомления нужно разбирать."))
        val pick = secondaryButton("Выбрать приложения")
        pick.setOnClickListener { showPackagePicker() }
        card.addView(pick)
        content.addView(card)
    }

    private fun addCheckCard() {
        val card = card("Проверка связи")
        card.addView(hint("Убедитесь, что приложение видит ваш аккаунт, счета и правила."))
        val check = secondaryButton("Проверить соединение")
        check.setOnClickListener {
            check.isEnabled = false
            check.alpha = 0.6f
            check.text = "Проверяю…"
            Thread {
                val uid = prefs.uid
                val token = auth.token()
                if (uid.isNullOrBlank() || token.isNullOrBlank()) {
                    runOnUiThread {
                        toast("Нет доступа к аккаунту, войдите заново")
                        render()
                    }
                } else {
                    val api = FirestoreApi(auth)
                    val accounts = api.accounts(uid, token)
                    val rules = api.rules(uid, token)
                    val withMask = accounts.count { it.cardMask != null }
                    runOnUiThread {
                        prefs.log("Связь есть: счетов $withMask с маской, правил ${rules.size}")
                        toast("Связь есть: карт с маской $withMask, правил ${rules.size}")
                        render()
                    }
                }
            }.start()
        }
        card.addView(check)
        content.addView(card)
    }

    // ---------- Обновления ----------

    private fun addUpdateCard() {
        val available = update
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(
                if (available != null) R.drawable.bg_card_accent else R.drawable.bg_card
            )
            setPadding(dp(16), dp(16), dp(16), dp(16))
            elevation = dp(1).toFloat()
            layoutParams = blockParams(bottom = 12)
        }
        card.addView(cardTitle("Версия и обновление"))
        card.addView(infoRow("Установлено", updater.currentVersion()))

        if (downloadingUpdate) {
            val label = hint(updateStatus ?: "Скачивание…", top = 12)
            progressLabel = label
            card.addView(label)
            content.addView(card)
            return
        }
        progressLabel = null

        if (available != null) {
            card.addView(
                hint(
                    "Доступна версия ${available.version}. Установка поверх: настройки, " +
                        "вход и выбранные банки сохранятся.",
                    top = 10,
                )
            )
            val install = primaryButton(
                if (downloadedFile != null) "Установить ${available.version}"
                else "Скачать и установить ${available.version}"
            )
            install.setOnClickListener { installUpdate(available) }
            card.addView(install)

            val later = textButton("Напомнить позже")
            later.setOnClickListener {
                update = null
                updateStatus = null
                render()
            }
            card.addView(later)
        } else {
            card.addView(hint("Приложение проверяет обновления при запуске.", top = 10))
            val check = secondaryButton(
                if (checkingUpdates) "Проверяю…" else "Проверить обновления"
            )
            check.isEnabled = !checkingUpdates
            if (!check.isEnabled) {
                check.alpha = 0.6f
            }
            check.setOnClickListener { checkUpdates(manual = true) }
            card.addView(check)
        }

        if (!updateStatus.isNullOrBlank()) {
            card.addView(hint(updateStatus!!, top = 12))
        }
        content.addView(card)
    }

    /** Автопроверка при открытии: не чаще раза в 6 часов и молча, без тостов об ошибках. */
    private fun autoCheckForUpdates() {
        if (autoCheckStarted || !updater.shouldAutoCheck()) {
            return
        }
        autoCheckStarted = true
        checkUpdates(manual = false)
    }

    private fun checkUpdates(manual: Boolean) {
        if (checkingUpdates || downloadingUpdate) {
            return
        }
        checkingUpdates = true
        if (manual) {
            updateStatus = null
        }
        render()
        Thread {
            val release = updater.latest()
            // Отмечаем проверку только при успешном ответе: без сети попробуем в следующий раз.
            if (release != null) {
                updater.markChecked()
            }
            val found = updater.newer(release)
            runOnUiThread {
                checkingUpdates = false
                if (found != null) {
                    update = found
                    downloadedFile = null
                    updateStatus = null
                } else if (manual) {
                    updateStatus = "Обновлений нет — установлена последняя версия"
                }
                render()
            }
        }.start()
    }

    private fun installUpdate(release: Updater.Release) {
        // Уже скачали ранее (например, открывали разрешение на установку) — ставим сразу.
        val ready = downloadedFile
        if (ready != null && ready.isFile && ready.length() > 10_000) {
            if (!updater.canInstall()) {
                toast("Разрешите установку из этого источника и нажмите ещё раз")
                updater.openInstallPermission()
                return
            }
            updater.install(ready)
            return
        }

        if (downloadingUpdate) {
            return
        }
        downloadingUpdate = true
        updateStatus = "Скачивание…"
        render()
        Thread {
            try {
                val file = updater.download(release) { percent ->
                    runOnUiThread {
                        updateStatus = "Скачивание… $percent%"
                        progressLabel?.text = updateStatus
                    }
                }
                runOnUiThread {
                    downloadingUpdate = false
                    downloadedFile = file
                    if (updater.canInstall()) {
                        updateStatus = "Скачано. Открываю установщик…"
                        render()
                        updater.install(file)
                    } else {
                        updateStatus = "Осталось разрешить установку из этого источника"
                        render()
                        toast("Разрешите установку из этого источника")
                        updater.openInstallPermission()
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    downloadingUpdate = false
                    downloadedFile = null
                    updateStatus = "Не удалось скачать: ${error.message}"
                    prefs.log("Обновление: ${error.message}")
                    render()
                }
            }
        }.start()
    }

    // ---------- Журнал ----------

    private fun addLogCard() {
        val card = card()
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(
            cardTitle("Журнал"),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        val clear = textButton("Очистить")
        clear.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        clear.setOnClickListener {
            prefs.clearLog()
            render()
        }
        row.addView(clear)
        card.addView(row)

        card.addView(
            TextView(this).apply {
                text = prefs.logText.ifBlank { "Пока пусто." }
                textSize = 11.5f
                typeface = Typeface.MONOSPACE
                setTextColor(color(R.color.text_muted))
                setTextIsSelectable(true)
                setBackgroundResource(R.drawable.bg_log_box)
                setPadding(dp(12), dp(12), dp(12), dp(12))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(10) }
            }
        )
        content.addView(card)
    }

    private fun addFooter() {
        content.addView(
            TextView(this).apply {
                text = "Данные пишутся только в ваш аккаунт. Категории и правила — " +
                    "в веб-приложении: Настройки → Автозаполнение из банка."
                textSize = 12f
                setTextColor(color(R.color.text_muted))
                gravity = Gravity.CENTER
                setLineSpacing(dp(2).toFloat(), 1f)
                setPadding(dp(8), dp(16), dp(8), 0)
            }
        )
    }

    // ---------- Выбор банков ----------

    private fun showPackagePicker() {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = packageManager.queryIntentActivities(intent, 0)
        val apps = resolved
            .map { it.loadLabel(packageManager).toString() to it.activityInfo.packageName }
            .distinctBy { it.second }
            .sortedBy { it.first.lowercase() }

        if (apps.isEmpty()) {
            toast("Приложения не найдены")
            return
        }

        val labels = apps.map { "${it.first}\n${it.second}" }.toTypedArray()
        val checked = BooleanArray(apps.size) { prefs.selectedPackages.contains(apps[it].second) }

        AlertDialog.Builder(this)
            .setTitle("Слушать уведомления")
            .setMultiChoiceItems(labels, checked) { _, which, isChecked ->
                checked[which] = isChecked
            }
            .setPositiveButton("Сохранить") { _, _ ->
                val selected = apps.filterIndexed { index, _ -> checked[index] }.map { it.second }.toSet()
                prefs.selectedPackages = selected
                prefs.log("Выбрано приложений: ${selected.size}")
                render()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun isListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?: return false
        return flat.contains(packageName)
    }

    // ---------- Стили ----------

    private fun card(title: String? = null): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            elevation = dp(1).toFloat()
            layoutParams = blockParams(bottom = 12)
        }
        if (title != null) {
            card.addView(cardTitle(title))
        }
        return card
    }

    private fun blockParams(bottom: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(bottom) }

    private fun cardTitle(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 15.5f
        setTextColor(color(R.color.text))
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private fun hint(text: String, top: Int = 8): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(color(R.color.text_muted))
        setLineSpacing(dp(2).toFloat(), 1f)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(top) }
    }

    private fun pill(text: String, ok: Boolean): TextView = TextView(this).apply {
        this.text = text
        textSize = 12f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(color(if (ok) R.color.ok_text else R.color.warn_text))
        setBackgroundResource(if (ok) R.drawable.bg_pill_ok else R.drawable.bg_pill_warn)
        setPadding(dp(10), dp(4), dp(10), dp(4))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(8) }
    }

    private fun infoRow(label: String, value: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(10) }
        addView(
            TextView(this@MainActivity).apply {
                text = label
                textSize = 13f
                setTextColor(color(R.color.text_muted))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
        )
        addView(
            TextView(this@MainActivity).apply {
                text = value
                textSize = 13f
                setTextColor(color(R.color.text))
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }
        )
    }

    private fun primaryButton(text: String): Button =
        baseButton(text, R.drawable.btn_primary, color(R.color.on_primary))

    private fun secondaryButton(text: String): Button =
        baseButton(text, R.drawable.btn_secondary, color(R.color.primary))

    private fun baseButton(text: String, backgroundRes: Int, textColor: Int): Button = Button(this).apply {
        this.text = text
        textSize = 14.5f
        isAllCaps = false
        setTextColor(textColor)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setBackgroundResource(backgroundRes)
        stateListAnimator = null
        minimumHeight = dp(48)
        setPadding(dp(16), 0, dp(16), 0)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(48),
        ).apply { topMargin = dp(10) }
    }

    private fun textButton(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(color(R.color.primary))
        setPadding(dp(8), dp(12), dp(8), dp(4))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
    }

    private fun field(hintText: String, value: String, variation: Int): EditText = EditText(this).apply {
        hint = hintText
        setText(value)
        inputType = InputType.TYPE_CLASS_TEXT or variation
        textSize = 15f
        setTextColor(color(R.color.text))
        setHintTextColor(color(R.color.text_muted))
        setBackgroundResource(R.drawable.bg_input)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(10) }
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }

    private fun color(res: Int): Int = getColor(res)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
