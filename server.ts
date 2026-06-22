import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Middleware to log requests
  app.use((req, res, next) => {
    if (req.path.includes('/ai/') || req.path.includes('/gemini')) {
      console.log(`[AI Request] ${req.method} ${req.path}`, req.body?.action || '');
    }
    next();
  });

  // Check for multiple possible env var names to avoid user confusion
  const rawKey = 
    process.env.MY_GEMINI_API_KEY || 
    process.env.GOOGLE_API_KEY || 
    process.env.VITE_MY_GEMINI_API_KEY ||
    "";

  // Strip possible quotes, non-printing characters and trim
  const API_KEY = rawKey.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^["']|["']$/g, '');

  console.log("--- AI Connection Debug ---");
  console.log("MY_GEMINI_API_KEY present:", !!process.env.MY_GEMINI_API_KEY);
  console.log("GOOGLE_API_KEY present:", !!process.env.GOOGLE_API_KEY);
  console.log("VITE_MY_GEMINI_API_KEY present:", !!process.env.VITE_MY_GEMINI_API_KEY);

  if (!API_KEY) {
    console.warn("⚠️ No API key found in any environment variable.");
  } else if (API_KEY.includes('your_api_key') || API_KEY.length < 20) {
    console.warn("⚠️ API key looks like a placeholder or is too short:", API_KEY);
  } else if (!API_KEY.startsWith('AIza')) {
    console.warn("⚠️ API key does not start with 'AIza', it might be invalid.");
  } else {
    const source = process.env.MY_GEMINI_API_KEY ? "MY_GEMINI_API_KEY" : 
                   process.env.GOOGLE_API_KEY ? "GOOGLE_API_KEY" : 
                   "VITE_MY_GEMINI_API_KEY";
    console.log(`✅ AI key loaded from ${source}. Length: ${API_KEY.length}, Starts with: ${API_KEY.substring(0, 6)}... Ends with: ...${API_KEY.substring(API_KEY.length - 4)}`);
  }
  console.log("---------------------------");

  const ai = new GoogleGenAI({
    apiKey: API_KEY
  });

  // Model configuration
  const MODEL_NAME = "gemini-3-flash-preview";

  // Load Firebase Config dynamically for server-side Botomat webhook automation
  let dbInstance: any = null;
  const initFirebaseServerSide = async () => {
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const firebaseConfig = JSON.parse(fs.readFileSync(configPath, { encoding: "utf-8" }));
        const { initializeApp } = await import("firebase/app");
        const { getFirestore } = await import("firebase/firestore");
        const firebaseApp = initializeApp(firebaseConfig);
        dbInstance = getFirestore(firebaseApp);
        console.log("🔥 Server-side Firestore initialized successfully!");
      }
    } catch (err) {
      console.error("Error initializing server-side Firebase app:", err);
    }
  };
  await initFirebaseServerSide();

  /**
   * Validates if the API key is present and looks valid
   */
  function validateApiKey(res: any) {
    if (!API_KEY || API_KEY.length < 20 || API_KEY.includes('your_api_key')) {
      console.error("❌ Invalid or missing API key in server.ts. Current key value:", API_KEY ? `${API_KEY.substring(0, 4)}...` : 'EMPTY');
      res.status(401).json({ 
        error: "AI_KEY_MISSING",
        message: "מפתח ה-API חסר או לא תקין. יש לוודא שהגדרתם את MY_GEMINI_API_KEY ב-Settings של AI Studio או בקובץ ה-.env של השרת."
      });
      return false;
    }
    return true;
  }

  app.post(["/api/gemini", "/.netlify/functions/gemini"], async (req, res) => {
    if (!validateApiKey(res)) return;

    try {
      const { action } = req.body;
      console.log(`[AI Server] Action: ${action}`);

      if (action === 'insights') {
        const { transactions, categories, currentMonth } = req.body;
        const dataSummary = (transactions || []).slice(0, 100).map((t: any) => ({
          date: t.date,
          amount: t.amount,
          description: t.description,
          category: (categories || []).find((c: any) => c.id === t.category)?.name || t.category,
          type: t.type
        }));

        const systemInstruction = `אתה מומחה פיננסי אישי וחכם. נתח לעומק את הנתונים הפיננסיים של המשתמש וספק תובנות מקצועיות, המלצות לחיסכון, אזהרות על הוצאות חריגות וטיפים לניהול תקציב נכון.

הנחיות לניתוח:
1. זהה חריגות משמעותיות: הוצאות שהן מעל הממוצע או קפיצות פתאומיות בקטגוריות מסוימות.
2. פלח את ההוצאות: זהה את 3 הקטגוריות הדומיננטיות והצע דרכים לייעול בהן.
3. פוטנציאל חיסכון: זהה הוצאות שנראות כ"מותרות" או הוצאות חוזרות שניתן לצמצם (כמו מנויים או אכילה בחוץ).
4. יחס הכנסות-הוצאות: האם המשתמש בגרעון או בעודף? תן עצה בהתאם.
5. טיפ התנהגותי: תן טיפ אחד קטן שאפשר ליישם כבר היום.

בסס את התובנות שלך על הנתונים המצורפים בצורה קונקרטית (ציין שמות בתי עסק וסכומים אם רלוונטי).
דבר בצורה נעימה, אמפתית, ברורה ומעודדת בעברית.

החזר טקסט בלבד במבנה של נקודות או פסקאות קצרות, עם כותרות מודגשות.`;

        const prompt = `נתונים: ${JSON.stringify(dataSummary)}
חודש נוכחי: ${currentMonth}`;

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { systemInstruction }
        });

        return res.json({ text: response.text || "" });
      }

      if (action === 'extract-transactions') {
        const { base64Image } = req.body;
        const dataOnly = base64Image.split(',')[1] || base64Image;
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{
            role: 'user',
            parts: [
              { text: "Extract financial data from this document. Return an array of transactions in JSON format." },
              { inlineData: { mimeType: "image/jpeg", data: dataOnly } }
            ]
          }],
          config: {
            systemInstruction: "You are a highly accurate Financial Data Extractor. Extract transactions from the image. Return ONLY a JSON array. Each object must have 'date' (YYYY-MM-DD), 'description' (the merchant or entity name), 'amount' (number), and 'notes' (any additional details like items bought or location). If multiple transactions are present, include them all.",
            responseMimeType: "application/json"
          }
        });

        return res.json({ text: response.text || "" });
      }

      if (action === 'extract-receipt') {
        const { base64Image, availableCategories } = req.body;
        const categoryNames = (availableCategories || []).map((c: any) => c.name).join(", ");
        const dataOnly = base64Image.split(',')[1] || base64Image;
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{
            role: 'user',
            parts: [
              { text: "Extract financial data from this receipt." },
              { inlineData: { mimeType: "image/jpeg", data: dataOnly } }
            ]
          }],
          config: {
            systemInstruction: `Role:
You are a highly accurate Financial Data Extractor specialized in receipt analysis.

Task:
Analyze the provided image and extract:
1. vendor: The name of the business or store.
2. date: The transaction date (format: YYYY-MM-DD).
3. total: The final amount paid (number).
4. category: Classify into one of these: [${categoryNames}].
5. notes: Any additional details, items, or specific details found on the receipt.
6. currency: The currency symbol or code.

Output Format:
Return ONLY a JSON object.`,
            responseMimeType: "application/json"
          }
        });

        return res.json({ text: response.text || "" });
      }

      if (action === 'categorize') {
        const { description, categories } = req.body;
        const categoryMap = (categories || []).reduce((acc: any, cat: any) => {
          acc[cat.name] = cat.id;
          return acc;
        }, {} as Record<string, string>);
        const categoryNames = Object.keys(categoryMap).join(", ");

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{
            role: 'user',
            parts: [{ text: `Business Name: "${description}"` }]
          }],
          config: {
            systemInstruction: `You are a categorization assistant for a budget app. 
Based on the business name, classify it into the most appropriate category from this list: [${categoryNames}].
If the exact category is unclear, provide the top 3 most likely category names.
Return a JSON object:
{
  "bestMatch": "Category Name",
  "suggestions": ["Category Name 1", "Category Name 2", "Category Name 3"]
}
If no suggestions are found, return empty array for suggestions.`,
            responseMimeType: "application/json"
          }
        });

        return res.json({ text: response.text || "" });
      }

      if (action === 'batch-categorize') {
        const { descriptions, categories } = req.body;
        const categoryMap = (categories || []).reduce((acc: any, cat: any) => {
          acc[cat.name] = cat.id;
          return acc;
        }, {} as Record<string, string>);
        const categoryNames = Object.keys(categoryMap).join(", ");

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{
            role: 'user',
            parts: [{ text: `Descriptions:\n${(descriptions || []).map((d: string, i: number) => `${i}: ${d}`).join("\n")}` }]
          }],
          config: {
            systemInstruction: `You are a categorization assistant for a budget app. Group business names into these categories: [${categoryNames}]. Return an object where keys are indices and values are category names. JSON format ONLY.`,
            responseMimeType: "application/json"
          }
        });

        return res.json({ text: response.text || "" });
      }

      return res.status(400).json({ error: "INVALID_ACTION", message: "פעולה לא תקינה" });

    } catch (error: any) {
      console.error("[AI Server Error]:", error);
      let message = "אירעה שגיאה בעיבוד הבקשה.";
      let statusCode = 500;

      if (error.message?.includes('API key not valid') || error.message?.includes('INVALID_ARGUMENT')) {
        message = "מפתח ה-API אינו תקין. יש לבדוק את הגדרות ה-MY_GEMINI_API_KEY.";
        statusCode = 401;
      }

      return res.status(statusCode).json({ error: error.message, message });
    }
  });

  // --- Botomat WhatsApp Integration Helper & Routes ---
  async function sendWhatsAppMessage(phone: string, text: string) {
    const apiKey = process.env.BOTOMAT_API_KEY;
    if (!apiKey) {
      throw new Error("BOTOMAT_API_KEY environment variable is not configured on the server.");
    }

    // Format phone to Israeli standard for WhatsApp (e.g. 972541234567)
    let cleanPhone = phone.replace(/\D/g, ""); // keep only digits
    if (cleanPhone.startsWith("05")) {
      cleanPhone = "972" + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith("5")) {
      cleanPhone = "972" + cleanPhone;
    }

    console.log(`[Botomat] Sending WhatsApp to: ${cleanPhone}`);

    const payload = {
      to: cleanPhone,
      phone: cleanPhone,
      recipient: cleanPhone,
      text: text,
      message: text,
      body: text
    };

    try {
      const response = await fetch("https://botomat.co.il/api/v1/messages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        console.log("[Botomat] Sent successfully via primary endpoint", data);
        return data;
      }

      const errText = await response.text();
      console.warn(`[Botomat] Primary endpoint failed (Status ${response.status}):`, errText);

      // Fallback: Try alternative /v1/messages/send
      const fallbackResponse = await fetch("https://botomat.co.il/api/v1/messages/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json().catch(() => ({}));
        console.log("[Botomat] Sent successfully via fallback endpoint-send", data);
        return data;
      }

      const fallbackErr = await fallbackResponse.text();
      throw new Error(`Botomat API failed. Status: ${fallbackResponse.status}, Error: ${fallbackErr}`);
    } catch (err: any) {
      console.error("[Botomat Send Error]:", err);
      throw err;
    }
  }

  // Frontend REST endpoint to trigger WhatsApp dispatch (e.g., test message, notifications)
  app.post("/api/botomat/send", async (req, res) => {
    try {
      const { phone, message } = req.body;
      if (!phone || !message) {
        return res.status(400).json({ error: "Missing required fields: phone and message" });
      }

      if (!process.env.BOTOMAT_API_KEY) {
        return res.status(401).json({ 
          error: "BOTOMAT_API_KEY_MISSING", 
          message: "מפתח ה-API של Botomat אינו מוגדר בשרת." 
        });
      }

      const result = await sendWhatsAppMessage(phone, message);
      return res.json({ success: true, result });
    } catch (err: any) {
      console.error("[API Botomat Send Error]:", err);
      return res.status(500).json({ error: err.message || "שגיאה בשליחת הודעה דרך Botomat" });
    }
  });

  // Webhook listener representingBotomat Israeli WhatsApp integration
  app.post("/api/botomat/webhook", async (req, res) => {
    console.log("[Botomat Webhook] Received webhook call:", JSON.stringify(req.body));
    
    // 1. Signature Verification (Optional check based on env variables)
    const webhookSecret = process.env.BOTOMAT_WEBHOOK_SECRET;
    const signature = req.headers["x-botomat-signature"] || req.headers["signature"] || req.headers["x-signature"];
    if (webhookSecret && signature) {
      try {
        const hmac = crypto.createHmac("sha256", webhookSecret);
        const digest = hmac.update(JSON.stringify(req.body)).digest("hex");
        if (digest !== signature) {
          console.warn("⚠️ Webhook signing mismatch! Computed:", digest, "Header:", signature);
        } else {
          console.log("✅ Webhook payload authenticated successfully!");
        }
      } catch (err) {
        console.error("Error verifying signature:", err);
      }
    }

    try {
      // 2. Extract sender phone and original message
      // Botomat webhook payload supports multiple common patterns
      const data = req.body.data || req.body;
      const senderPhoneRaw = data.from || data.sender || data.phone || (data.message && data.message.from);
      const textRaw = data.text || data.message || data.body || (data.message && (data.message.text || data.message.body));

      if (!senderPhoneRaw || !textRaw) {
        console.log("[Botomat Webhook] Unknown event or missing fields. Skipping automatic parsing.");
        return res.json({ status: "skipped", reason: "missing sender or message text" });
      }

      const senderPhone = String(senderPhoneRaw).trim();
      const text = String(textRaw).trim();
      console.log(`[Botomat bot] Message from ${senderPhone}: "${text}"`);

      // 3. Search settings for this user's phone number
      if (!dbInstance) {
        console.warn("⚠️ Firebase dbInstance not loaded on server. Cannot automate WhatsApp flow.");
        return res.json({ status: "skipped", reason: "server Firebase not loaded" });
      }

      const { collection, getDocs, addDoc, query, where } = await import("firebase/firestore");
      
      const settingsRef = collection(dbInstance, "settings");
      const snap = await getDocs(settingsRef);
      
      let matchedUserId = null;
      let matchedAccountId = null;
      let userSettings: any = null;

      // Normalise phone: e.g. "972541234567" -> "0541234567" for flexible comparing
      const normInput = senderPhone.replace(/\D/g, "").replace(/^972/, "0");

      for (const d of snap.docs) {
        const setVal = d.data();
        if (setVal.whatsappNumber && setVal.whatsappEnabled) {
          const normDb = setVal.whatsappNumber.replace(/\D/g, "").replace(/^972/, "0");
          if (normDb === normInput || setVal.whatsappNumber === senderPhone) {
            matchedUserId = d.id;
            matchedAccountId = setVal.accountId;
            userSettings = setVal;
            break;
          }
        }
      }

      if (!matchedUserId || !matchedAccountId) {
        console.log(`[Botomat Webhook] Could not find an account with active WhatsApp for phone ${senderPhone}`);
        return res.json({ status: "unregistered", phone: senderPhone });
      }

      const normalizedText = text.toLowerCase().trim();

      // COMMAND: דוח / יתרה / תקציב / report
      if (
        normalizedText === "דוח" ||
        normalizedText === "דו\"ח" ||
        normalizedText === "יתרה" ||
        normalizedText === "תקציב" ||
        normalizedText === "status" ||
        normalizedText === "report"
      ) {
        console.log(`[Botomat bot] Fetching report for account ${matchedAccountId}`);
        
        // Fetch current month's transactions and budgets
        const txQuery = query(collection(dbInstance, "transactions"), where("accountId", "==", matchedAccountId));
        const budgetsQuery = query(collection(dbInstance, "budgets"), where("accountId", "==", matchedAccountId));
        
        const [txSnap, budgetsSnap] = await Promise.all([getDocs(txQuery), getDocs(budgetsQuery)]);
        
        const txs = txSnap.docs.map(doc => doc.data());
        const budgetsList = budgetsSnap.docs.map(doc => doc.data());

        // Calculate for the current month
        const now = new Date();
        const currentMonthString = now.toISOString().substring(0, 7); // "YYYY-MM"

        const monthTxs = txs.filter((tx: any) => tx.date && tx.date.startsWith(currentMonthString));
        const income = monthTxs.filter((tx: any) => tx.type === "income").reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const expenses = monthTxs.filter((tx: any) => tx.type === "expense").reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
        const totalBudget = budgetsList.reduce((sum: number, b: any) => sum + (Number(b.amount) || 0), 0);
        const balance = income - expenses;
        const remaining = Math.max(0, totalBudget - expenses);

        const summaryText = `📊 *סיכום תקציב חודשי (Tachlit)* 📊
        
📅 *חודש:* ${now.getMonth() + 1}/${now.getFullYear()}
💰 *הכנסות:* ₪${income.toLocaleString()}
💸 *הוצאות:* ₪${expenses.toLocaleString()}
⚖️ *יתרה חודשית:* ₪${balance.toLocaleString()}

🎯 *תקציב מוגדר:* ₪${totalBudget.toLocaleString()}
📈 *יתרה בתקציב:* ₪${remaining.toLocaleString()}

*שמח לעזור!* כדי להוסיף הוצאה, שלחו למשל: \`הוצאה 50 סופר\``;

        await sendWhatsAppMessage(senderPhone, summaryText);
        return res.json({ status: "success", action: "sent_report" });
      }

      // COMMAND: הוצאה [סכום] [רפטור] / הכנסה [סכום] [רפטור]
      const txRegex = /^(הוצאה|הכנסה)\s+(\d+(?:\.\d+)?)\s+(.+)$/i;
      const match = text.match(txRegex);

      if (match) {
        const flowType = match[1] === "הכנסה" ? "income" : "expense";
        const amount = parseFloat(match[2]);
        const description = match[3].trim();

        console.log(`[Botomat bot] Creating transaction via WhatsApp: ${flowType}, ${amount}, ${description}`);

        // Try to automatically categorize the transaction
        let categoryId = "general";
        try {
          const catRef = collection(dbInstance, "accounts", matchedAccountId, "categories");
          const catSnap = await getDocs(catRef);
          const categories = catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          // Simple keyword/name matcher
          const matchedCat = categories.find((c: any) => {
            const keywords = c.keywords || [];
            return (
              c.name.toLowerCase().includes(description.toLowerCase()) ||
              keywords.some((kw: string) => description.toLowerCase().includes(kw.toLowerCase()))
            );
          });

          if (matchedCat) {
            categoryId = matchedCat.id;
          }
        } catch (e) {
          console.error("Failed to fetch/categorize WhatsApp transaction:", e);
        }

        // Add to db
        const newDocPayload = {
          amount,
          description,
          category: categoryId,
          type: flowType,
          date: new Date().toISOString().split("T")[0],
          userId: matchedUserId,
          accountId: matchedAccountId,
          createdAt: new Date().toISOString(),
          notes: "הוזן אוטומטית באמצעות WhatsApp Botomat"
        };

        await addDoc(collection(dbInstance, "transactions"), newDocPayload);

        const verbLine = flowType === "expense" ? "נרשמה בהצלחה" : "נכנסה לחשבון";
        const successMsg = `✅ *הפעולה נרשמה בהצלחה ב-Tachlit!*

📝 *סוג הפעולה:* ${flowType === "expense" ? "הוצאה 💸" : "הכנסה 💰"}
💵 *סכום:* ₪${amount.toLocaleString()}
🏬 *פרטים:* ${description}
🏷️ *קטגוריה:* ${categoryId === "general" ? "כללי" : categoryId}

*הנתונים עודכנו ומסתנכרנים באפליקציה!*`;
        
        await sendWhatsAppMessage(senderPhone, successMsg);
        return res.json({ status: "success", action: "created_transaction", details: newDocPayload });
      }

      // Default message / Welcome manual
      const helpMsg = `שלום! אני הבוט האישי שלך ב-Tachlit 🤖

הנה הפקודות שאני מבין:
📊 *"דוח"* או *"יתרה"* - לקבלת סיכום התקציב הנוכחי שלך
💸 *"הוצאה [סכום] [פרטים]"* - להזנת הוצאה חדשה (למשל: הוצאה 50 תחנת דלק)
💰 *"הכנסה [סכום] [פרטים]"* - להזנת הכנסה חדשה (למשל: הכנסה 5000 משכורת)

Tachlit - הדרך החכמה לנהל את התקציב שלך 🚀`;

      await sendWhatsAppMessage(senderPhone, helpMsg);
      return res.json({ status: "success", action: "sent_help" });

    } catch (webhookErr: any) {
      console.error("[Botomat Webhook Processing Error]:", webhookErr);
      return res.status(500).json({ error: webhookErr.message || "שגיאה בעיבוד ה-webhook של Botomat" });
    }
  });

  // Serve frontend in production
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Vite middleware for dev
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
