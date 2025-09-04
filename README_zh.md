# BookingPro（Next.js + Firebase）— 開發版

一個可擴充的預約系統（健身/課程/場地通用）。目前已完成：
- 可預約時段列表（/slots）、建立預約（Transaction：**容量遞減 + 防重複預約**）
- 我的預約（/me/bookings）：取消預約（Transaction：**容量回補 + 清除唯一鍵**）
- 管理端：排程產生器（/admin/slots）、時段管理（/admin/slots/manage：開關/調整容量/候補補位）
- 候補名單（waitlist）：名額滿可加入、管理端一鍵補位（含索引備援）
- LINE Messaging API 推播：新預約/取消預約/候補補位 → **通知管理員**

---

## 技術棧
- **Next.js 15**（App Router, Turbopack）+ **React 18** + **Tailwind**
- **Firebase**：Auth（匿名登入，開發期）、Firestore（Standard）
- **Vercel**：CI/CD + 靜態資源託管
- TypeScript

---

## 本機快速啟動
### 1) 安裝
```bash
npm i
```

### 2) 設定 .env.local
```env
# 本機開發埠（已在 package.json 鎖定）
PORT=49155

# Firebase Web Config（從 Firebase Console 的 Web App 複製）
NEXT_PUBLIC_FIREBASE_API_KEY=xxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxx

# LINE Messaging API（在 LINE Developers 產生）
LINE_CHANNEL_ACCESS_TOKEN=xxx
LINE_CHANNEL_SECRET=xxx
# 管理員（接收推播的對象）— 你的 Your user ID（U 開頭）
LINE_ADMIN_USER_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3) 啟動開發伺服器
```bash
npm run dev
# 本機： http://127.0.0.1:49155
```

## Firebase 設定（開發期）

### Firestore：選 Standard，區域可選 Taiwan（或 asia-southeast1 皆可）。

### Authentication：啟用 匿名登入（開發期）。

### 規則（開發期寬鬆版）：已測試版本如下，上線前會收緊。
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /slots/{id}      { allow read: if true; allow write: if request.auth != null; }
    match /services/{id}   { allow read: if true; allow write: if request.auth != null; }
    match /resources/{id}  { allow read: if true; allow write: if request.auth != null; }
    match /orgs/{id}       { allow read: if true; allow write: if request.auth != null; }
    match /locations/{id}  { allow read: if true; allow write: if request.auth != null; }

    match /bookings/{id} {
      allow read:   if request.auth != null && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.uid;
    }
    match /bookingKeys/{id} {
      allow create, delete: if request.auth != null;
      allow read: if request.auth != null;
      allow update: if false;
    }
    match /waitlists/{id} {
      allow read:   if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
      allow delete: if request.auth != null;
      allow update: if false;
    }

    match /{document=**} { allow read, write: if false; }
  }
}
```

## 索引：新增 waitlists 的複合索引

- 欄位1：slotId（升冪）
- 欄位2：createdAt（升冪）

## 主要路由

- `/`：首頁導覽（自動匿名登入）
- `/slots`：可預約時段清單、建立預約（含 LINE 通知管理員）
- `/me/bookings`：我的預約、取消（含 LINE 通知管理員）
- `/admin/slots`：排程產生器（批量建立 slots）
- `/admin/slots/manage`：管理時段（開關/容量 ±1/從候補補位）

## Debug：

- `/debug/seed`：建立示範 org/location/resource/service/slot
- `/debug/firestore`：匿名登入＋讀寫健康檢查
- `/debug/line`：LINE 推播測試（手動輸入 userId）
- `/debug/line-admin`：對管理員固定推播

## 部署到 Vercel

1. 連接 GitHub Repo（Production Branch：main）。
2. Environment Variables：將 `.env.local` 的變數逐一新增（不加引號）。
3. `next.config.ts` 已設定：
   ```ts
   export default {
     eslint: { ignoreDuringBuilds: true }, // 先讓部署通過
   };
   ```

> 若曾加過 Prisma，請移除 `prisma/` 與套件（Firebase 路線用不到）。

## 上線前安全清單（建議）

- **用戶登入**：改用 Email/Google，禁用匿名登入；導入角色（OWNER/MANAGER/COACH/MEMBER）。
- **管理頁保護**：`/admin/*` 僅管理者可進；可用自訂 Claims 或儲存角色於 `users` 集合。
- **規則收斂**：`slots/services/resources/orgs/locations` 寫入只允許管理者；`bookingKeys` 由 Cloud Functions 或 Server 端建立。
- **稽核/通知**：加入預約變更的審計欄位（by/at），補上 Email/SMS/LINE 群組推播。
- **Rate limit**：對建立/取消預約加節流；防止惡意操作。
- **金流**：後續可接 ECPay/NewebPay（Webhooks → 更新 `bookings` 狀態）。

## 疑難排解（我們遇過的）

- **EACCES: 0.0.0.0:3000**：Windows 的 Excluded Port Range 佔用 2950–3049 → 改高位埠（49155）或刪除保留範圍。
- **Vercel 404 新頁面**：多半是 Build 失敗（Prisma、ESLint）→ 移除 Prisma、`ignoreDuringBuilds: true`。
- **The query requires an index**：照上面索引建立；或先走「無排序 → 前端排序」備援。
- **Missing or insufficient permissions**：檢查 Firestore 規則是否允許當前操作。
- **LINE Followers API 403**：多數帳號無權限 → 改用手動貼上 Your user ID 測試推播。

## 待辦（Roadmap）

會員制與 RBAC、金流、iCal/Google Calendar、通知中心（Email/SMS/LINE 多通道）、報表儀表板、黑名單與違約金、折扣碼/課包、Webhook 事件。