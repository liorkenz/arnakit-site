# Texte à envoyer/dire à Cardcom

Copie-colle ceci dans leur formulaire "אשמח לדבר", ou lis-le tel quel au téléphone (03-9436100).

---

שלום,

אני מעוניין לפתוח חשבון סליקה עבור העסק שלי:

- **שם העסק:** ארנקית (Arnakit)
- **סוג עוסק:** עוסק פטור
- **מספר עוסק:** 337927156
- **שם בעל העסק:** ליאור קניזו

**על העסק:** ארנקית הוא שירות SaaS (מנוי חודשי) לעסקים קטנים בישראל — מאפשר להם להנפיק כרטיסי מועדון דיגיטליים ב-Apple Wallet ו-Google Wallet. הלקוחות שלי (בעלי עסקים) נרשמים דרך אתר ומשלמים מנוי חודשי מתחדש.

**מה אני צריך:**
- סליקה אונליין עם **חיוב אוטומטי חוזר (recurring/token billing)** — הלקוח מזין כרטיס פעם אחת, ואני מחייב אותו כל חודש דרך ה-API, ללא כל פעולה נוספת מצידו.
- **גישת API** לאינטגרציה ישירה באתר שלי (LowProfile / Transactions API) — אני צריך לקבל **Terminal Number** ו-**API Name** לצורך החיבור הטכני.

אשמח לתאם פתיחת חשבון בהקדם האפשרי.

תודה,
ליאור קניזו

---

**Une fois le compte ouvert**, va dans leur back-office (souvent Paramètres → ניהול מפתחות API / API Keys) et récupère :
- **Terminal Number** (numéro de terminal)
- **API Name** (nom de la clé API)

Envoie-les moi ici dès que tu les as — je les configure côté serveur immédiatement.
