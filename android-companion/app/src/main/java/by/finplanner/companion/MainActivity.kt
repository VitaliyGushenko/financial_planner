package by.finplanner.companion

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * Единственный экран настроек: вход, доступ к уведомлениям, выбор банков, журнал.
 * UI собирается кодом, чтобы не тянуть внешние зависимости.
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

        val scroll = ScrollView(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(32))
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
        content.addView(title("Планировщик — банк"))
        content.addView(
            hint(
                "Приложение слушает уведомления выбранных банков и записывает операции " +
                    "в ваш планировщик. Пароль не хранится — только токен входа."
            )
        )

        val signedIn = !prefs.refreshToken.isNullOrBlank() && !prefs.uid.isNullOrBlank()
        if (!signedIn) {
            renderLogin()
        } else {
            renderAccount()
            renderNotificationAccess()
            renderPackages()
            renderCheck()
        }
        renderUpdate()
        renderLog()

        content.addView(
            hint(
                "Данные пишутся только в ваш аккаунт. Список категорий и правила " +
                    "настраиваются в веб-приложении: Настройки → Автозаполнение из банка."
            )
        )
    }

    private fun renderLogin() {
        content.addView(section("Вход"))
        content.addView(hint("Тот же email и пароль, что и в веб-приложении."))

        val email = edit("Email", prefs.email ?: "", InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = edit("Пароль", "", InputType.TYPE_TEXT_VARIATION_PASSWORD)
        content.addView(email)
        content.addView(password)

        val signIn = button("Войти")
        signIn.setOnClickListener {
            val mail = email.text.toString().trim()
            val pass = password.text.toString()
            if (mail.isBlank() || pass.isBlank()) {
                toast("Введите email и пароль")
                return@setOnClickListener
            }
            signIn.isEnabled = false
            signIn.text = "Вход…"
            Thread {
                val uid = auth.signIn(mail, pass)
                runOnUiThread {
                    if (uid == null) {
                        toast("Не удалось войти. Проверьте email, пароль и интернет.")
                        render()
                    } else {
                        prefs.log("Вход выполнен: $mail")
                        render()
                    }
                }
            }.start()
        }
        content.addView(signIn)
    }

    private fun renderAccount() {
        content.addView(section("Аккаунт"))
        content.addView(hint(prefs.email ?: "—"))
        val signOut = button("Выйти")
        signOut.setOnClickListener {
            auth.signOut()
            prefs.log("Выход из аккаунта")
            render()
        }
        content.addView(signOut)
    }

    private fun renderNotificationAccess() {
        content.addView(section("Доступ к уведомлениям"))
        val enabled = isListenerEnabled()
        content.addView(
            hint(
                if (enabled) "Доступ выдан — приложение слушает уведомления."
                else "Доступ не выдан. Без него операции не будут приходить."
            )
        )
        val open = button("Открыть настройки доступа")
        open.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            } catch (error: Exception) {
                toast("Не удалось открыть настройки: ${error.message}")
            }
        }
        content.addView(open)
    }

    private fun renderPackages() {
        val selected = prefs.selectedPackages
        content.addView(section("Приложения банков (${selected.size})"))
        content.addView(hint("Выберите приложения, чьи уведомления нужно разбирать."))
        val pick = button("Выбрать приложения")
        pick.setOnClickListener { showPackagePicker() }
        content.addView(pick)
    }

    private fun renderCheck() {
        content.addView(section("Проверка"))
        val check = button("Проверить соединение")
        check.setOnClickListener {
            check.isEnabled = false
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
        content.addView(check)
    }

    private fun renderUpdate() {
        content.addView(section("Версия и обновление"))
        content.addView(hint("Установлено: ${updater.currentVersion()}"))

        val available = update
        if (downloadingUpdate) {
            val label = hint(updateStatus ?: "Скачивание…")
            progressLabel = label
            content.addView(label)
            return
        }
        progressLabel = null

        if (available != null) {
            content.addView(
                hint(
                    "Доступна версия ${available.version}. Установка поверх: " +
                        "настройки, вход и выбранные банки сохранятся."
                )
            )
            val install = button(
                if (downloadedFile != null) "Установить ${available.version}"
                else "Скачать и установить ${available.version}"
            )
            install.setOnClickListener { installUpdate(available) }
            content.addView(install)

            val later = button("Напомнить позже")
            later.setOnClickListener {
                update = null
                updateStatus = null
                render()
            }
            content.addView(later)
        } else {
            val check = button(if (checkingUpdates) "Проверяю…" else "Проверить обновления")
            check.isEnabled = !checkingUpdates
            check.setOnClickListener { checkUpdates(manual = true) }
            content.addView(check)
        }

        if (!downloadingUpdate && !updateStatus.isNullOrBlank()) {
            content.addView(hint(updateStatus!!))
        }
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

    private fun renderLog() {
        content.addView(section("Журнал"))
        val log = TextView(this).apply {
            text = prefs.logText.ifBlank { "Пока пусто." }
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        content.addView(log)

        val clear = button("Очистить журнал")
        clear.setOnClickListener {
            prefs.clearLog()
            render()
        }
        content.addView(clear)
    }

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
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(packageName)
    }

    private fun section(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(18), 0, dp(4))
    }

    private fun title(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 22f
        setTypeface(typeface, Typeface.BOLD)
    }

    private fun hint(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setPadding(0, dp(2), 0, dp(6))
    }

    private fun edit(hintText: String, value: String, variation: Int): EditText = EditText(this).apply {
        hint = hintText
        setText(value)
        inputType = InputType.TYPE_CLASS_TEXT or variation
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(6) }
    }

    private fun button(text: String): Button = Button(this).apply {
        this.text = text
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(8) }
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
