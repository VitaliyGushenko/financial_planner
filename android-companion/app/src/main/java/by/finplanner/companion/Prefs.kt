package by.finplanner.companion

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Настройки и журнал работы — в приватном хранилище приложения. */
class Prefs(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("companion", Context.MODE_PRIVATE)

    var email: String?
        get() = prefs.getString("email", null)
        set(value) {
            prefs.edit().putString("email", value).apply()
        }

    var uid: String?
        get() = prefs.getString("uid", null)
        set(value) {
            prefs.edit().putString("uid", value).apply()
        }

    var idToken: String?
        get() = prefs.getString("idToken", null)
        set(value) {
            prefs.edit().putString("idToken", value).apply()
        }

    var refreshToken: String?
        get() = prefs.getString("refreshToken", null)
        set(value) {
            prefs.edit().putString("refreshToken", value).apply()
        }

    var tokenExp: Long
        get() = prefs.getLong("tokenExp", 0L)
        set(value) {
            prefs.edit().putLong("tokenExp", value).apply()
        }

    /** Пакеты приложений, уведомления которых слушаем. */
    var selectedPackages: Set<String>
        get() = prefs.getStringSet("packages", emptySet()) ?: emptySet()
        set(value) {
            prefs.edit().putStringSet("packages", value).apply()
        }

    /** Журнал: последние события, новые сверху. */
    val logText: String
        get() = prefs.getString("log", "") ?: ""

    fun log(line: String) {
        val time = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault()).format(Date())
        val next = "[$time] $line\n$logText"
        val trimmed = next.lines().filter { it.isNotBlank() }.take(80).joinToString("\n")
        prefs.edit().putString("log", trimmed).apply()
    }

    fun clearLog() {
        prefs.edit().remove("log").apply()
    }

    fun clearAuth() {
        prefs.edit()
            .remove("email")
            .remove("uid")
            .remove("idToken")
            .remove("refreshToken")
            .remove("tokenExp")
            .apply()
    }
}
