package by.finplanner.companion

import org.json.JSONArray
import org.json.JSONObject

/**
 * Запись операций в Firestore через REST — без Firebase SDK и без Google Play Services.
 * Повторяет логику веб-приложения: операция + атомарный increment баланса счёта.
 */
class FirestoreApi(private val auth: AuthApi) {

    data class AccountInfo(val id: String, val cardMask: String?, val type: String)

    data class RuleInfo(
        val keywords: List<String>,
        val kind: String,
        val categoryId: String,
        val subcategoryId: String?,
        val priority: Int,
        val enabled: Boolean,
    )

    data class NewTransaction(
        val kind: String,
        val amount: Double,
        val accountId: String,
        val categoryId: String?,
        val subcategoryId: String?,
        val dateKey: String,
        val timeIso: String,
        val merchant: String?,
        val cardMask: String?,
        val rawText: String,
        val balanceDelta: Double,
    )

    private val root = "https://firestore.googleapis.com/v1/projects/${Api.PROJECT}/databases/(default)/documents"

    fun accounts(uid: String, token: String): List<AccountInfo> {
        val result = Api.get("$root/users/$uid/accounts?pageSize=100", token)
        if (result.code != 200) {
            return emptyList()
        }
        val documents = JSONObject(result.body).optJSONArray("documents") ?: return emptyList()
        val list = ArrayList<AccountInfo>()
        for (index in 0 until documents.length()) {
            val document = documents.getJSONObject(index)
            val id = document.optString("name").substringAfterLast('/')
            list.add(
                AccountInfo(
                    id = id,
                    cardMask = stringField(document, "cardMask"),
                    type = stringField(document, "type") ?: "card",
                )
            )
        }
        return list
    }

    /** Основной счёт из настроек веб-приложения (users/{uid}/bankSettings/main). */
    fun defaultAccountId(uid: String, token: String): String? {
        val result = Api.get("$root/users/$uid/bankSettings/main", token)
        if (result.code != 200) {
            return null
        }
        return stringField(JSONObject(result.body), "defaultAccountId")
    }

    fun rules(uid: String, token: String): List<RuleInfo> {
        val result = Api.get("$root/users/$uid/bankRules?pageSize=200", token)
        if (result.code != 200) {
            return emptyList()
        }
        val documents = JSONObject(result.body).optJSONArray("documents") ?: return emptyList()
        val list = ArrayList<RuleInfo>()
        for (index in 0 until documents.length()) {
            val document = documents.getJSONObject(index)
            val keywords = stringArrayField(document, "keywords")
            val categoryId = stringField(document, "categoryId") ?: continue
            val kind = stringField(document, "kind") ?: continue
            list.add(
                RuleInfo(
                    keywords = keywords,
                    kind = kind,
                    categoryId = categoryId,
                    subcategoryId = stringField(document, "subcategoryId"),
                    priority = longField(document, "priority")?.toInt() ?: 0,
                    enabled = booleanField(document, "enabled") ?: true,
                )
            )
        }
        return list
    }

    /** Создаёт операцию и (если счёт существует) атомарно меняет его баланс. */
    fun createTransaction(
        uid: String,
        docId: String,
        tx: NewTransaction,
        accountExists: Boolean,
    ): Api.HttpResult {
        val token = auth.token() ?: return Api.HttpResult(401, "no token")
        val documentName = "$root/users/$uid/transactions/$docId"

        val fields = JSONObject()
        fields.put("kind", JSONObject().put("stringValue", tx.kind))
        fields.put("amount", JSONObject().put("doubleValue", tx.amount))
        fields.put("accountId", JSONObject().put("stringValue", tx.accountId))
        fields.put("date", JSONObject().put("stringValue", tx.dateKey))
        fields.put("applied", JSONObject().put("booleanValue", true))
        fields.put("source", JSONObject().put("stringValue", "bank"))
        fields.put("sourceId", JSONObject().put("stringValue", docId))
        fields.put("rawText", JSONObject().put("stringValue", tx.rawText))
        fields.put("createdAt", JSONObject().put("timestampValue", tx.timeIso))
        if (!tx.categoryId.isNullOrBlank()) {
            fields.put("categoryId", JSONObject().put("stringValue", tx.categoryId))
        }
        if (!tx.subcategoryId.isNullOrBlank()) {
            fields.put("subcategoryId", JSONObject().put("stringValue", tx.subcategoryId))
        }
        if (!tx.merchant.isNullOrBlank()) {
            fields.put("merchant", JSONObject().put("stringValue", tx.merchant))
            fields.put("note", JSONObject().put("stringValue", tx.merchant))
        }
        if (!tx.cardMask.isNullOrBlank()) {
            fields.put("cardMask", JSONObject().put("stringValue", tx.cardMask))
        }

        val writes = JSONArray()
        val create = JSONObject()
            .put("update", JSONObject().put("name", documentName).put("fields", fields))
            .put("currentDocument", JSONObject().put("exists", false))
        writes.put(create)

        if (accountExists && tx.balanceDelta != 0.0) {
            val transform = JSONObject()
                .put("document", "$root/users/$uid/accounts/${tx.accountId}")
                .put(
                    "fieldTransforms",
                    JSONArray().put(
                        JSONObject()
                            .put("fieldPath", "balance")
                            .put("increment", JSONObject().put("doubleValue", tx.balanceDelta))
                    )
                )
            writes.put(
                JSONObject()
                    .put("transform", transform)
                    .put("currentDocument", JSONObject().put("exists", true))
            )
        }

        return Api.post("$root:commit", JSONObject().put("writes", writes).toString(), token)
    }

    fun addInbox(uid: String, packageName: String, text: String, reason: String): Boolean {
        val token = auth.token() ?: return false
        val fields = JSONObject()
        fields.put("packageName", JSONObject().put("stringValue", packageName))
        fields.put("text", JSONObject().put("stringValue", text))
        fields.put("reason", JSONObject().put("stringValue", reason))
        fields.put(
            "createdAt",
            JSONObject().put("timestampValue", isoNow())
        )
        fields.put(
            "postedAt",
            JSONObject().put("timestampValue", isoNow())
        )
        val result = Api.post(
            "$root/users/$uid/bankInbox",
            JSONObject().put("fields", fields).toString(),
            token,
        )
        return result.code in 200..299
    }

    private fun isoNow(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())

    private fun stringField(document: JSONObject, name: String): String? {
        val fields = document.optJSONObject("fields") ?: return null
        val field = fields.optJSONObject(name) ?: return null
        return if (field.has("stringValue")) field.getString("stringValue") else null
    }

    private fun longField(document: JSONObject, name: String): Long? {
        val fields = document.optJSONObject("fields") ?: return null
        val field = fields.optJSONObject(name) ?: return null
        return when {
            field.has("integerValue") -> field.getString("integerValue").toLongOrNull()
            field.has("doubleValue") -> field.getDouble("doubleValue").toLong()
            else -> null
        }
    }

    private fun booleanField(document: JSONObject, name: String): Boolean? {
        val fields = document.optJSONObject("fields") ?: return null
        val field = fields.optJSONObject(name) ?: return null
        return if (field.has("booleanValue")) field.getBoolean("booleanValue") else null
    }

    private fun stringArrayField(document: JSONObject, name: String): List<String> {
        val fields = document.optJSONObject("fields") ?: return emptyList()
        val field = fields.optJSONObject(name) ?: return emptyList()
        val array = field.optJSONObject("arrayValue")?.optJSONArray("values") ?: return emptyList()
        val list = ArrayList<String>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            if (item.has("stringValue")) {
                list.add(item.getString("stringValue"))
            }
        }
        return list
    }
}

/** Выбор правила по тексту — та же логика, что в веб-приложении. */
object RulePicker {
    fun pick(rules: List<FirestoreApi.RuleInfo>, text: String, kind: String): FirestoreApi.RuleInfo? {
        val haystack = text.uppercase().replace(Regex("""\s+"""), " ")
        return rules
            .filter { it.enabled && it.kind == kind }
            .filter { rule ->
                val keywords = rule.keywords.map { it.uppercase().trim() }.filter { it.isNotEmpty() }
                keywords.isNotEmpty() && keywords.any { haystack.contains(it) }
            }
            .sortedWith(compareByDescending<FirestoreApi.RuleInfo> { it.priority }.thenByDescending { it.keywords.size })
            .firstOrNull()
    }
}
