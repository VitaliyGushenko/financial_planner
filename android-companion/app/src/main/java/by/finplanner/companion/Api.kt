package by.finplanner.companion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Минимальный клиент REST API Firebase: вход и обновление токена. */
object Api {
    const val KEY = "AIzaSyDYH0-5L1zGhjJ9ec1Vt2zduZuMMJ5l6XQ"
    const val PROJECT = "financial-planner-e1c41"

    data class HttpResult(val code: Int, val body: String)

    fun post(url: String, body: String, token: String?, contentType: String = "application/json"): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", contentType)
            if (!token.isNullOrBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResult(code, text)
        } finally {
            connection.disconnect()
        }
    }

    fun get(url: String, token: String?): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            if (!token.isNullOrBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResult(code, text)
        } finally {
            connection.disconnect()
        }
    }
}

/**
 * Вход по email/паролю того же аккаунта, что и в веб-приложении.
 * Пароль не сохраняется: хранится только refresh-token.
 */
class AuthApi(private val prefs: Prefs) {

    fun signIn(email: String, password: String): String? {
        val body = JSONObject()
            .put("email", email)
            .put("password", password)
            .put("returnSecureToken", true)
            .toString()
        val result = Api.post(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${Api.KEY}",
            body,
            null,
        )
        if (result.code != 200) {
            return null
        }
        val json = JSONObject(result.body)
        prefs.uid = json.optString("localId")
        prefs.idToken = json.optString("idToken")
        prefs.refreshToken = json.optString("refreshToken")
        prefs.tokenExp = System.currentTimeMillis() + json.optLong("expiresIn", 3600L) * 1000L
        prefs.email = email
        return prefs.uid
    }

    /** Действующий id-token; при истечении обновляется по refresh-token. */
    fun token(): String? {
        val cached = prefs.idToken
        if (!cached.isNullOrBlank() && System.currentTimeMillis() < prefs.tokenExp - 60_000L) {
            return cached
        }
        val refresh = prefs.refreshToken ?: return null
        val form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8")
        val result = Api.post(
            "https://securetoken.googleapis.com/v1/token?key=${Api.KEY}",
            form,
            null,
            "application/x-www-form-urlencoded",
        )
        if (result.code != 200) {
            return null
        }
        val json = JSONObject(result.body)
        val idToken = json.optString("id_token")
        if (idToken.isBlank()) {
            return null
        }
        prefs.idToken = idToken
        prefs.refreshToken = json.optString("refresh_token", refresh)
        prefs.tokenExp = System.currentTimeMillis() + json.optLong("expires_in", 3600L) * 1000L
        return idToken
    }

    fun signOut() = prefs.clearAuth()
}
