package by.finplanner.companion

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Обновление приложения через GitHub Releases.
 *
 * Полностью «тихую» установку Android обычным приложениям не разрешает:
 * система всё равно покажет окно подтверждения. Но APK скачивается сам,
 * а «Обновить» ставит новую версию поверх старой — данные и вход сохраняются,
 * потому что все сборки подписаны одним ключом (keystore/companion.jks).
 */
class Updater(private val activity: Activity, private val prefs: Prefs) {

    data class Release(
        val version: String,
        val apkUrl: String,
        val apkName: String,
        val apkSize: Long,
    )

    private data class HttpResult(val code: Int, val body: String)

    /** Версия установленного приложения, например «1.2». */
    @Suppress("DEPRECATION")
    fun currentVersion(): String {
        return try {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0"
        } catch (error: Exception) {
            "0"
        }
    }

    /** Последний релиз `companion-*` на GitHub или null, если сети или релиза нет. */
    fun latest(): Release? {
        val response = request(
            RELEASES_URL,
            mapOf(
                "Accept" to "application/vnd.github+json",
                "User-Agent" to "financial-planner-companion",
            ),
        ) ?: return null
        if (response.code != 200) {
            return null
        }
        val releases = try {
            JSONArray(response.body)
        } catch (error: Exception) {
            return null
        }
        // GitHub отдаёт релизы от новых к старым — берём первый подходящий.
        for (index in 0 until releases.length()) {
            val release = releases.optJSONObject(index) ?: continue
            if (release.optBoolean("draft")) {
                continue
            }
            val tag = release.optString("tag_name")
            if (!tag.startsWith(TAG_PREFIX)) {
                continue
            }
            val assets = release.optJSONArray("assets") ?: continue
            for (assetIndex in 0 until assets.length()) {
                val asset = assets.optJSONObject(assetIndex) ?: continue
                val name = asset.optString("name")
                if (name.endsWith(".apk", ignoreCase = true)) {
                    return Release(
                        version = tag.removePrefix(TAG_PREFIX),
                        apkUrl = asset.optString("browser_download_url"),
                        apkName = name,
                        apkSize = asset.optLong("size"),
                    )
                }
            }
        }
        return null
    }

    /** Возвращает релиз, только если он новее установленного. */
    fun newer(release: Release?): Release? {
        if (release == null) {
            return null
        }
        return if (compareVersions(release.version, currentVersion()) > 0) release else null
    }

    /** Проверять автоматически при запуске, но не чаще раза в 6 часов. */
    fun shouldAutoCheck(): Boolean {
        return System.currentTimeMillis() - prefs.lastUpdateCheck > CHECK_INTERVAL
    }

    fun markChecked() {
        prefs.lastUpdateCheck = System.currentTimeMillis()
    }

    /**
     * Скачивает APK в кэш и возвращает файл.
     * onProgress получает 0..100; если размер неизвестен, прогресс не вызывается.
     */
    fun download(release: Release, onProgress: (Int) -> Unit): File {
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        // Прошлые загрузки удаляем, чтобы не копить мегабайты в кэше.
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, release.apkName.ifBlank { "companion.apk" })

        val connection = URL(release.apkUrl).openConnection() as HttpURLConnection
        return try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 20_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("User-Agent", "financial-planner-companion")
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("сервер вернул $code")
            }
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: release.apkSize
            var copied = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) {
                            break
                        }
                        output.write(buffer, 0, read)
                        copied += read
                        if (total > 0) {
                            onProgress((copied * 100 / total).toInt().coerceIn(0, 100))
                        }
                    }
                }
            }
            // Защита от случая, когда вместо APK пришла HTML-страница.
            if (target.length() < 10_000) {
                throw IllegalStateException("файл слишком мал — похоже, скачалась страница вместо APK")
            }
            target
        } finally {
            connection.disconnect()
        }
    }

    fun canInstall(): Boolean = activity.packageManager.canRequestPackageInstalls()

    /** Системный экран «Разрешить установку из этого источника». */
    fun openInstallPermission() {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:${activity.packageName}")),
            )
        } catch (error: Exception) {
            activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
        }
    }

    /** Передаёт скачанный APK системному установщику. */
    fun install(file: File) {
        val uri = Uri.parse("content://${ApkProvider.AUTHORITY}/${Uri.encode(file.name)}")
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(intent)
    }

    private fun request(url: String, headers: Map<String, String>): HttpResult? {
        return try {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "GET"
                connection.connectTimeout = 15_000
                connection.readTimeout = 20_000
                headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                HttpResult(code, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
            } finally {
                connection.disconnect()
            }
        } catch (error: Exception) {
            null
        }
    }

    companion object {
        private const val REPO = "VitaliyGushenko/financial_planner"
        private const val TAG_PREFIX = "companion-v"
        private const val RELEASES_URL = "https://api.github.com/repos/$REPO/releases?per_page=20"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val CHECK_INTERVAL = 6 * 60 * 60 * 1000L

        /** Числовое сравнение версий: «1.10» новее «1.9». Возвращает 1, 0 или -1. */
        fun compareVersions(a: String, b: String): Int {
            val left = a.split('.', '-', '+').map { it.toIntOrNull() ?: 0 }
            val right = b.split('.', '-', '+').map { it.toIntOrNull() ?: 0 }
            for (index in 0 until maxOf(left.size, right.size)) {
                val diff = left.getOrElse(index) { 0 } - right.getOrElse(index) { 0 }
                if (diff != 0) {
                    return if (diff > 0) 1 else -1
                }
            }
            return 0
        }
    }
}
