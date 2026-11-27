package by.finplanner.companion

/**
 * Разбор текста уведомлений белорусских банков (формат BAPB/Беларусбанк).
 *
 * Примеры:
 *  OPLATA 62.46 BYN  KARTA #1310 DATA 24.11.2026 21:06:56 BAPB - OPLATA USLUG>MINSK>BLR OSTATOK 2366.19 BYN
 *  NALICHNYE 125.00 BYN  KARTA #1310 DATA 23.11.2026 17:51:08 SHOP OAO VESTA BR.795/ >VITEBSK>BY OSTATOK 1256.31 BYN
 *  ZACHISLENIE NA SCHET KARTA #7880 DATA 24.11.2026 12:08:03 SUMMA 1182.00 BYN OSTATOK 2428.65 BYN
 */
object BankParser {

    data class Parsed(
        val kind: String,
        val amount: Double,
        val cardMask: String?,
        val merchant: String?,
        val dateKey: String?,
        val timeIso: String?,
        val balance: Double?,
    )

    private val dateRegex = Regex("""DATA\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})""")
    private val cardRegex = Regex("""KARTA\s+#(\d{4})""")
    private val balanceRegex = Regex("""OSTATOK\s+([0-9]+[.,][0-9]{2})""")
    private val expenseRegex = Regex("""(OPLATA|NALICHNYE|SPISANIE)\s+([0-9]+[.,][0-9]{1,2})\s+BYN""")
    private val incomeRegex = Regex("""ZACHISLENIE.*?SUMMA\s+([0-9]+[.,][0-9]{1,2})\s+BYN""")
    private val incomeCardRegex = Regex("""ZACHISLENIE.*?KARTA\s+#(\d{4})""")

    fun normalize(raw: String): String = raw
        .uppercase()
        .replace("\u00A0", " ")
        .replace(Regex("""\s+"""), " ")
        .trim()

    /** Похоже ли уведомление на банковское (иначе игнорируем, чтобы не спамить). */
    fun looksLikeBank(raw: String): Boolean {
        val text = normalize(raw)
        return text.contains("BYN") || text.contains("KARTA") || text.contains("SUMMA") || text.contains("OSTATOK")
    }

    fun parse(raw: String): Parsed? {
        val text = normalize(raw)
        val card = cardRegex.find(text)?.groupValues?.get(1)
        val balance = balanceRegex.find(text)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull()

        val dateMatch = dateRegex.find(text)
        val dateKey = dateMatch?.let {
            val (day, month, year) = it.destructured
            "$year-$month-$day"
        }
        val timeIso = dateMatch?.let {
            val day = it.groupValues[1]
            val month = it.groupValues[2]
            val year = it.groupValues[3]
            val hour = it.groupValues[4]
            val minute = it.groupValues[5]
            val second = it.groupValues[6]
            "${year}-${month}-${day}T${hour}:${minute}:${second}Z"
        }

        val income = incomeRegex.find(text)
        if (income != null) {
            val amount = income.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
            val incomeCard = incomeCardRegex.find(text)?.groupValues?.get(1) ?: card
            return Parsed(
                kind = "income",
                amount = amount,
                cardMask = incomeCard,
                merchant = null,
                dateKey = dateKey,
                timeIso = timeIso,
                balance = balance,
            )
        }

        val expense = expenseRegex.find(text) ?: return null
        val amount = expense.groupValues[2].replace(',', '.').toDoubleOrNull() ?: return null
        val merchant = if (dateMatch != null) {
            text.substring(dateMatch.range.last + 1)
                .substringBefore(" OSTATOK")
                .substringBefore('>')
                .trim()
                .ifBlank { null }
        } else {
            null
        }
        return Parsed(
            kind = "expense",
            amount = amount,
            cardMask = card,
            merchant = merchant,
            dateKey = dateKey,
            timeIso = timeIso,
            balance = balance,
        )
    }
}
