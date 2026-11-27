package by.finplanner.companion

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Минимальная замена FileProvider из androidx: отдаёт установщику APK
 * из приватной папки cacheDir/updates.
 *
 * Своя реализация — чтобы приложение по-прежнему собиралось без внешних зависимостей.
 * Доступ только по одноразовому разрешению на конкретный content:// URI
 * (FLAG_GRANT_READ_URI_PERMISSION), сам провайдер не экспортируется.
 */
class ApkProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val file = fileFor(uri) ?: return null
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        val file = fileFor(uri) ?: return null
        val names = (projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE))
            .toList()
            .toTypedArray()
        val cursor = MatrixCursor(names)
        cursor.addRow(
            names.map { column ->
                when (column) {
                    OpenableColumns.DISPLAY_NAME -> file.name
                    OpenableColumns.SIZE -> file.length()
                    else -> null
                }
            }.toTypedArray(),
        )
        return cursor
    }

    override fun getType(uri: Uri): String = "application/vnd.android.package-archive"

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    /** Только файлы из cacheDir/updates: выход за пределы папки запрещён. */
    private fun fileFor(uri: Uri): File? {
        val context = context ?: return null
        val name = uri.lastPathSegment ?: return null
        val root = File(context.cacheDir, "updates").canonicalFile
        val file = File(root, name).canonicalFile
        if (!file.path.startsWith(root.path + File.separator) || !file.isFile) {
            return null
        }
        return file
    }

    companion object {
        const val AUTHORITY = "by.finplanner.companion.updates"
    }
}
