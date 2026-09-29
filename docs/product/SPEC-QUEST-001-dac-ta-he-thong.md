# QUEST — Nền tảng theo dõi sức khỏe game hóa
## Tài liệu đặc tả hệ thống (Software Specification)

| | |
|---|---|
| **Mã tài liệu** | SPEC-QUEST-001 |
| **Phiên bản** | 1.0 |
| **Ngày** | 09/09/2026 |
| **Trạng thái** | Bản nháp để review |
| **Nguồn** | Viết lại từ bản mô tả ý tưởng `website's script (health).docx` |

> **Ghi chú về tên gọi:** "QUEST" là tên tạm dùng xuyên suốt tài liệu để tiện tham chiếu. Tên chính thức sẽ chốt ở giai đoạn thiết kế thương hiệu.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Nguyên tắc thiết kế](#2-nguyên-tắc-thiết-kế)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Mô hình dữ liệu](#4-mô-hình-dữ-liệu)
5. [Đặc tả tính năng](#5-đặc-tả-tính-năng)
6. [Quy tắc nghiệp vụ xuyên suốt](#6-quy-tắc-nghiệp-vụ-xuyên-suốt)
7. [Giao diện API](#7-giao-diện-api)
8. [Yêu cầu phi chức năng](#8-yêu-cầu-phi-chức-năng)
9. [An toàn sức khỏe và đạo đức sản phẩm](#9-an-toàn-sức-khỏe-và-đạo-đức-sản-phẩm)
10. [Quyền riêng tư và bảo mật](#10-quyền-riêng-tư-và-bảo-mật)
11. [Lộ trình triển khai](#11-lộ-trình-triển-khai)
12. [Tiêu chí thành công](#12-tiêu-chí-thành-công)
13. [Rủi ro và giả định](#13-rủi-ro-và-giả-định)
- [Phụ lục A — Bảng thuật ngữ](#phụ-lục-a--bảng-thuật-ngữ)
- [Phụ lục B — Thay đổi so với bản nháp gốc](#phụ-lục-b--thay-đổi-so-với-bản-nháp-gốc)

---

## 1. Tổng quan

### 1.1. Bối cảnh

Người trẻ làm việc và học tập trước màn hình có đủ kiến thức về dinh dưỡng và vận động, nhưng thiếu **động lực duy trì**. Các ứng dụng theo dõi sức khỏe phổ biến đặt gánh nặng nhập liệu lên người dùng mà trả lại rất ít phản hồi tức thời — biểu đồ và con số không tạo ra vòng lặp hành vi.

QUEST đặt cược vào một giả thuyết: nếu bọc dữ liệu sinh học hằng ngày trong ngữ pháp của game nhập vai — chỉ số nhân vật, nhiệm vụ, cấp độ, tổ đội — thì hành vi ghi nhận và duy trì thói quen sẽ trở nên đáng làm hơn.

### 1.2. Định vị sản phẩm

QUEST là **ứng dụng web theo dõi sức khỏe và thói quen có yếu tố game hóa**, không phải một trò chơi. Mọi cơ chế game phủ lên trên dữ liệu hành vi có thật; không có nội dung game tồn tại độc lập với hành vi thực tế của người dùng.

### 1.3. Mục tiêu sản phẩm

| Mã | Mục tiêu |
|---|---|
| G-01 | Rút thời gian ghi nhận một ngày xuống dưới 60 giây |
| G-02 | Trả về lộ trình dinh dưỡng và tập luyện cá nhân hóa ngay sau onboarding, không cần người dùng tự tính toán |
| G-03 | Duy trì tỉ lệ quay lại ngày kế tiếp (D1 retention) trên 40% |
| G-04 | Tạo áp lực đồng lứa tích cực qua cơ chế tổ đội, không qua cơ chế trừng phạt |

### 1.4. Mục tiêu kỹ thuật

Đây đồng thời là dự án chứng minh năng lực. Các hạng mục kỹ thuật được chủ đích đưa vào phạm vi:

- **Thiết kế cơ sở dữ liệu quan hệ**: chuẩn hóa, ràng buộc toàn vẹn, chỉ mục cho truy vấn bảng xếp hạng.
- **Thuật toán cá nhân hóa**: chuỗi tính toán từ chỉ số sinh học đến mục tiêu năng lượng và bộ lọc nội dung.
- **Máy trạng thái (state machine)**: vòng đời linh vật và vòng đời nhiệm vụ ngày.
- **Xử lý tác vụ nền theo lịch**: chốt ngày, tính chuỗi, tổng hợp bảng xếp hạng.
- **Thiết kế idempotent**: mọi ghi nhận đều an toàn khi lặp lại.

### 1.5. Phạm vi

**Trong phạm vi (MVP)**

- Onboarding và tính toán mục tiêu năng lượng
- Bảng nhiệm vụ ngày, XP, cấp độ, chuỗi ngày
- Thư viện thực đơn và bài tập tĩnh (do quản trị viên nạp sẵn)
- Linh vật, tiền tệ nội bộ, cửa hàng giao diện
- Tổ đội, bảng xếp hạng tuần, tính năng nhắc nhở
- Góc giải tỏa và vé đóng băng chuỗi

**Ngoài phạm vi (giai đoạn này)**

- Đồng bộ với thiết bị đeo (Apple Health, Google Fit, Garmin)
- Nhận diện món ăn qua ảnh
- Ứng dụng di động gốc (native)
- Bất kỳ tư vấn y tế cá nhân hóa nào vượt ngoài công thức năng lượng chuẩn
- Tính năng nhắn tin tự do giữa người dùng

### 1.6. Người dùng mục tiêu

| Nhóm | Mô tả | Nhu cầu chính |
|---|---|---|
| Sinh viên / nhân viên văn phòng 18–30 | Ngồi máy tính 6–10 tiếng/ngày, có nền tảng game | Động lực và cấu trúc, không phải thêm kiến thức |
| Người mới tập | Chưa biết bắt đầu từ đâu | Lộ trình có sẵn, ngưỡng khởi động thấp |
| Người đã tập nhưng hay bỏ giữa chừng | Đã thử 2–3 app khác | Lý do để quay lại vào ngày thứ tám |

---

## 2. Nguyên tắc thiết kế

Bốn nguyên tắc sau ràng buộc mọi quyết định thiết kế trong tài liệu này. Khi hai tính năng xung đột, nguyên tắc ở trên thắng.

**P1 — Dữ liệu thật là nguồn chân lý duy nhất.**
Chỉ số nhân vật là hàm dẫn xuất từ hành vi đã ghi nhận. Người dùng không được phép chỉnh trực tiếp chỉ số nhân vật; nếu chỉnh được, chỉ số mất hết ý nghĩa.

**P2 — Động viên, không sỉ nhục.**
Cơ chế game hóa được phép tạo tiếc nuối khi bỏ lỡ, nhưng không được chế giễu người dùng. Đây là ứng dụng sức khỏe, không phải ứng dụng kỷ luật.

**P3 — Tha thứ có giới hạn.**
Hệ thống phải có đường thoát cho ngày xấu (vé đóng băng), nhưng đường thoát phải khan hiếm, nếu không chuỗi ngày mất hết giá trị.

**P4 — An toàn thắng động lực.**
Không cơ chế nào được đẩy người dùng vào mục tiêu năng lượng nguy hiểm, dù mục tiêu đó tạo cảm giác tiến bộ nhanh hơn.

---

## 3. Kiến trúc hệ thống

### 3.1. Ngăn xếp công nghệ đề xuất

| Tầng | Lựa chọn | Lý do |
|---|---|---|
| Giao diện | Next.js (App Router) + TypeScript | SSR cho trang public, client component cho dashboard tương tác |
| Trạng thái client | TanStack Query + Zustand | Cache truy vấn, optimistic update cho thao tác tick nhiệm vụ |
| API | Next.js Route Handlers (REST) | Đủ cho quy mô MVP, không cần tách service |
| ORM | Prisma | Type-safe end-to-end với TypeScript |
| CSDL | PostgreSQL | Ràng buộc quan hệ, `GENERATED` column, window function cho xếp hạng |
| Cache / hàng đợi | Redis | Cache bảng xếp hạng, rate limit nhắc nhở |
| Tác vụ nền | Cron job (Vercel Cron hoặc node-cron) | Chốt ngày, tổng hợp tuần |
| Thông báo đẩy | Web Push API (VAPID) | Không phụ thuộc nhà cung cấp bên thứ ba |
| Xác thực | Auth.js (email + OAuth) | — |

> **Giả định:** ngăn xếp trên là đề xuất, không phải ràng buộc. Nếu đổi sang stack khác, phần 4 (mô hình dữ liệu) và 5 (đặc tả tính năng) vẫn giữ nguyên hiệu lực.

### 3.2. Sơ đồ khối

```
┌─────────────────────────────────────────────────────────┐
│  CLIENT (Next.js)                                        │
│  Onboarding · Dashboard · Focus Player · Guild · Shop    │
└───────────────────────┬─────────────────────────────────┘
                        │ REST / JSON
┌───────────────────────▼─────────────────────────────────┐
│  API LAYER                                               │
│  ┌──────────────┬──────────────┬──────────────────────┐ │
│  │ Profile &    │ Quest &      │ Social &             │ │
│  │ Prescription │ Progression  │ Leaderboard          │ │
│  └──────┬───────┴──────┬───────┴─────────┬────────────┘ │
└─────────┼──────────────┼─────────────────┼──────────────┘
          │              │                 │
┌─────────▼──────────────▼─────────────────▼──────────────┐
│  DOMAIN SERVICES                                         │
│  EnergyCalculator · StatMapper · PrescriptionEngine      │
│  XpLedger · StreakEngine · PetStateMachine · GuildScorer │
└─────────┬───────────────────────────────┬────────────────┘
          │                               │
┌─────────▼──────────┐         ┌──────────▼───────────────┐
│  PostgreSQL         │         │  Redis                   │
│  (nguồn chân lý)    │         │  (cache, rate limit)     │
└─────────────────────┘         └──────────────────────────┘
          ▲
┌─────────┴───────────────────────────────────────────────┐
│  SCHEDULED JOBS                                          │
│  day-close · weekly-rollover · reminder-dispatch         │
└─────────────────────────────────────────────────────────┘
```

### 3.3. Luồng dữ liệu chính

**Luồng A — Khởi tạo hồ sơ**

```
Form onboarding
  → validate (khoảng hợp lệ của chiều cao/cân nặng/tuổi)
  → EnergyCalculator: BMR → TDEE → calorieTarget → macroSplit
  → guardrail an toàn (§9.1)
  → ghi User + BiometricSnapshot + Prescription
  → StatMapper sinh chỉ số nhân vật ban đầu
  → render dashboard
```

**Luồng B — Ghi nhận hành vi trong ngày**

```
Người dùng tick một nhiệm vụ
  → optimistic UI cập nhật ngay
  → POST /quests/{id}/complete (idempotency key = userId+questId+logicalDate)
  → ghi QuestCompletion + bút toán XpLedger + bút toán CoinLedger
  → tính lại XP/level, chỉ số nhân vật, trạng thái linh vật
  → trả về delta để client hiển thị hiệu ứng
```

**Luồng C — Chốt ngày (job nền)**

```
Mỗi giờ, với mỗi múi giờ vừa qua mốc chốt ngày:
  → lấy các DailyLog thuộc ngày logic vừa đóng
  → đủ nhiệm vụ bắt buộc?  → streak += 1
  → không đủ, có vé đóng băng đã dùng? → streak giữ nguyên
  → không đủ, không có vé?  → streak = 0
  → cập nhật trạng thái linh vật
  → cộng điểm tổ đội
```

---

## 4. Mô hình dữ liệu

### 4.1. Sơ đồ quan hệ

```
User ──1:N── BiometricSnapshot
  │
  ├──1:1── Prescription        (mục tiêu năng lượng hiện hành)
  ├──1:1── Pet
  ├──1:1── ProgressionState    (xp, level, streak, coin)
  ├──1:N── DailyLog ──1:N── QuestCompletion ──N:1── Quest
  ├──1:N── XpLedger
  ├──1:N── CoinLedger
  ├──1:N── FreezeTicket
  ├──1:N── JournalEntry
  ├──1:N── Inventory ──N:1── ShopItem
  ├──1:N── NudgeEvent          (gửi và nhận)
  └──N:1── GuildMembership ──N:1── Guild ──1:N── GuildWeeklyScore

Quest ──N:1── ExerciseItem | MealPlan   (nhiệm vụ sinh ra từ đơn kê)
```

### 4.2. Lược đồ Prisma

```prisma
// ---------- Danh tính và hồ sơ ----------

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  displayName  String
  timezone     String   @default("Asia/Ho_Chi_Minh") // IANA tz
  archetype    Archetype
  archetypeSetAt DateTime @default(now())
  createdAt    DateTime @default(now())
  deletedAt    DateTime?                             // xóa mềm

  snapshots       BiometricSnapshot[]
  prescription    Prescription?
  pet             Pet?
  progression     ProgressionState?
  dailyLogs       DailyLog[]
  xpLedger        XpLedger[]
  coinLedger      CoinLedger[]
  freezeTickets   FreezeTicket[]
  journalEntries  JournalEntry[]
  inventory       Inventory[]
  guildMembership GuildMembership?
  nudgesSent      NudgeEvent[] @relation("sender")
  nudgesReceived  NudgeEvent[] @relation("receiver")

  @@index([deletedAt])
}

enum Archetype {
  TANKER      // tăng cơ, kháng lực nặng
  ASSASSIN    // giảm mỡ, sức bền, cardio/HIIT
  SUPPORTER   // tư thế, giấc ngủ, dinh dưỡng sạch, giảm căng thẳng
}

/// Bản ghi bất biến. Mỗi lần người dùng cập nhật số đo → thêm dòng mới,
/// không ghi đè. Cho phép vẽ biểu đồ tiến trình và tái tính đơn kê.
model BiometricSnapshot {
  id           String   @id @default(cuid())
  userId       String
  heightCm     Float
  weightKg     Float
  birthYear    Int
  sex          Sex
  activityLevel ActivityLevel
  recordedAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, recordedAt(sort: Desc)])
}

enum Sex { MALE FEMALE }

enum ActivityLevel {
  SEDENTARY    // 1.200
  LIGHT        // 1.375
  MODERATE     // 1.550
  ACTIVE       // 1.725
  VERY_ACTIVE  // 1.900
}

/// Đầu ra của EnergyCalculator. Tính lại khi snapshot mới hoặc đổi hệ phái.
model Prescription {
  id             String   @id @default(cuid())
  userId         String   @unique
  bmr            Float
  tdee           Float
  calorieTarget  Float
  proteinG       Float
  carbsG         Float
  fatG           Float
  waterMl        Int      @default(2000)
  safetyClamped  Boolean  @default(false) // true nếu guardrail §9.1 đã can thiệp
  computedAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ---------- Tiến trình ----------

model ProgressionState {
  userId         String   @id
  xp             Int      @default(0)
  level          Int      @default(1)
  coin           Int      @default(0)
  streakCurrent  Int      @default(0)
  streakBest     Int      @default(0)
  perkPoints     Int      @default(0) // điểm mở khóa tiện ích, KHÔNG phải chỉ số cơ thể
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

/// Sổ cái chỉ ghi thêm. XP hiện tại = SUM(amount). Cho phép truy vết và
/// hoàn tác chính xác, tránh sai lệch do cập nhật đồng thời.
model XpLedger {
  id        String   @id @default(cuid())
  userId    String
  amount    Int
  reason    String   // "QUEST_COMPLETE", "LEVEL_BONUS", "JOURNAL", ...
  refId     String?  // id của QuestCompletion tương ứng
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, reason, refId])  // chặn cộng trùng
  @@index([userId, createdAt])
}

model CoinLedger {
  id        String   @id @default(cuid())
  userId    String
  amount    Int      // âm khi tiêu
  reason    String
  refId     String?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, reason, refId])
  @@index([userId, createdAt])
}

// ---------- Nhiệm vụ ----------

model Quest {
  id            String     @id @default(cuid())
  code          String     @unique   // "WATER_8", "WORKOUT_MAIN", "STAND_UP", ...
  title         String
  category      QuestCategory
  targetCount   Int        @default(1)  // 8 với nhiệm vụ uống nước
  xpReward      Int
  coinReward    Int
  archetypes    Archetype[]             // hệ phái nào nhận nhiệm vụ này
  isActive      Boolean    @default(true)
}

enum QuestCategory {
  STORY    // bắt buộc — quyết định chuỗi ngày
  DAILY    // tùy chọn — thói quen nhỏ
  HIDDEN   // mở khóa theo điều kiện thời gian
}

/// Một dòng cho mỗi người dùng mỗi ngày logic.
model DailyLog {
  id            String   @id @default(cuid())
  userId        String
  logicalDate   DateTime @db.Date   // ngày logic tại timezone người dùng
  caloriesIn    Float    @default(0)
  waterMl       Int      @default(0)
  bedtimeMarkedAt DateTime?         // thời điểm bấm "Kết thúc ngày"
  closedAt      DateTime?           // job chốt ngày đã xử lý dòng này chưa
  storyCompleted Boolean @default(false)

  user        User @relation(fields: [userId], references: [id], onDelete: Cascade)
  completions QuestCompletion[]

  @@unique([userId, logicalDate])
  @@index([logicalDate, closedAt])
}

model QuestCompletion {
  id          String   @id @default(cuid())
  dailyLogId  String
  questId     String
  progress    Int      @default(0)   // 0..targetCount
  completedAt DateTime?

  dailyLog DailyLog @relation(fields: [dailyLogId], references: [id], onDelete: Cascade)
  quest    Quest    @relation(fields: [questId], references: [id])

  @@unique([dailyLogId, questId])
}

// ---------- Thư viện nội dung ----------

model MealPlan {
  id           String   @id @default(cuid())
  name         String
  kcal         Float
  proteinG     Float
  carbsG       Float
  fatG         Float
  mealSlot     MealSlot
  tags         String[]  // "chay", "ít-nấu", "ngoài-hàng"
  imageUrl     String?
}

enum MealSlot { BREAKFAST LUNCH DINNER SNACK }

model ExerciseItem {
  id           String   @id @default(cuid())
  name         String
  modality     Modality
  durationSec  Int
  spaceNeeded  SpaceRequirement
  equipment    String[]
  metValue     Float     // dùng để ước lượng calo tiêu hao
  videoUrl     String?
  archetypes   Archetype[]
}

enum Modality { RESISTANCE CARDIO HIIT MOBILITY BREATHING }
enum SpaceRequirement { DESK_SIDE ROOM GYM OUTDOOR }

// ---------- Linh vật ----------

model Pet {
  userId     String    @id
  name       String
  stage      PetStage  @default(EGG)
  mood       PetMood   @default(NEUTRAL)
  growth     Int       @default(0)  // 0..100 trong stage hiện tại
  skinId     String?
  updatedAt  DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum PetStage  { EGG HATCHLING JUVENILE ADULT MYTHIC }  // một chiều, không lùi
enum PetMood   { HAPPY NEUTRAL TIRED }                  // hai chiều, đáy là TIRED

// ---------- Cửa hàng ----------

model ShopItem {
  id        String   @id @default(cuid())
  code      String   @unique   // "THEME_CYBERPUNK_NEON", "PET_SKIN_FOX"
  name      String
  kind      ShopItemKind
  priceCoin Int
  minLevel  Int      @default(1)
  assetUrl  String
}

enum ShopItemKind { THEME PET_SKIN BADGE }

model Inventory {
  id         String   @id @default(cuid())
  userId     String
  shopItemId String
  equipped   Boolean  @default(false)
  acquiredAt DateTime @default(now())

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  shopItem ShopItem @relation(fields: [shopItemId], references: [id])

  @@unique([userId, shopItemId])
}

// ---------- Tổ đội ----------

model Guild {
  id        String   @id @default(cuid())
  name      String   @unique
  motto     String?
  inviteCode String  @unique
  createdAt DateTime @default(now())

  members GuildMembership[]
  scores  GuildWeeklyScore[]
}

model GuildMembership {
  userId   String   @id
  guildId  String
  role     GuildRole @default(MEMBER)
  joinedAt DateTime  @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@index([guildId])
}

enum GuildRole { LEADER MEMBER }

/// Kết quả tổng hợp mỗi tuần. Không tính lại khi truy vấn bảng xếp hạng.
model GuildWeeklyScore {
  id            String   @id @default(cuid())
  guildId       String
  weekStart     DateTime @db.Date
  avgCompletion Float    // 0..1 — tỉ lệ hoàn thành trung bình mỗi thành viên
  activeMembers Int
  rank          Int?

  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade)

  @@unique([guildId, weekStart])
  @@index([weekStart, avgCompletion(sort: Desc)])
}

model NudgeEvent {
  id         String   @id @default(cuid())
  senderId   String
  receiverId String
  templateCode String  // nội dung lấy từ danh sách cố định, không nhập tự do
  sentAt     DateTime @default(now())

  sender   User @relation("sender",   fields: [senderId],   references: [id], onDelete: Cascade)
  receiver User @relation("receiver", fields: [receiverId], references: [id], onDelete: Cascade)

  @@index([receiverId, sentAt])
  @@index([senderId, sentAt])
}

// ---------- Góc giải tỏa ----------

model JournalEntry {
  id           String   @id @default(cuid())
  userId       String
  bodyEncrypted Bytes   // mã hóa ở tầng ứng dụng, xem §10.2
  quoteCode    String   // câu trích dẫn đã trả về
  createdAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}

model FreezeTicket {
  id        String    @id @default(cuid())
  userId    String
  grantedAt DateTime  @default(now())
  usedAt    DateTime?
  usedForDate DateTime? @db.Date

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
}
```

---

## 5. Đặc tả tính năng

### F-01 — Onboarding và khởi tạo hồ sơ

**Mô tả.** Màn hình nhiều bước thu thập chỉ số sinh học và mục tiêu, kết thúc bằng việc sinh nhân vật.

**Đầu vào.**

| Trường | Kiểu | Khoảng hợp lệ | Bắt buộc |
|---|---|---|---|
| `heightCm` | float | 120 – 230 | ✓ |
| `weightKg` | float | 30 – 250 | ✓ |
| `birthYear` | int | tuổi 16 – 90 | ✓ |
| `sex` | enum | MALE / FEMALE | ✓ |
| `activityLevel` | enum | 5 mức | ✓ |
| `archetype` | enum | 3 hệ phái | ✓ |
| `timezone` | string | IANA tz, tự phát hiện, cho phép sửa | ✓ |

**Hệ phái.** Hệ phái là *bộ lọc nội dung và trọng số mục tiêu*, không phải một lớp nhân vật có chỉ số riêng.

| Hệ phái | Nhóm mục tiêu | Ảnh hưởng đến đơn kê |
|---|---|---|
| **Đỡ Đòn** (Tanker) | Tăng cơ, kháng lực nặng | Thặng dư năng lượng +10% TDEE; protein 2.0 g/kg; ưu tiên bài `RESISTANCE` |
| **Sát Thủ** (Assassin) | Giảm mỡ, tăng sức bền | Thâm hụt −15% TDEE; protein 2.0 g/kg; ưu tiên `CARDIO`, `HIIT` |
| **Hỗ Trợ** (Supporter) | Tư thế, giấc ngủ, giảm căng thẳng | Duy trì ±0% TDEE; protein 1.6 g/kg; ưu tiên `MOBILITY`, `BREATHING` |

**Quy tắc.**
- R-01.1 — Người dùng được đổi hệ phái, tối đa **một lần mỗi 14 ngày**. Đổi hệ phái kích hoạt tính lại `Prescription` nhưng **không** reset XP, cấp độ hay chuỗi ngày.
- R-01.2 — Mỗi lần cập nhật số đo tạo một `BiometricSnapshot` mới; bản ghi cũ không bị ghi đè.
- R-01.3 — Người dùng dưới 16 tuổi bị từ chối ở bước xác thực tuổi, kèm thông báo giải thích.

**Đầu ra.** Bản ghi `User`, `BiometricSnapshot`, `Prescription`, `ProgressionState`, `Pet` (stage `EGG`) và chuyển hướng đến dashboard.

---

### F-02 — Bộ tính năng lượng (EnergyCalculator)

**Công thức BMR — Mifflin-St Jeor**

```
Nam:  BMR = 10·W + 6.25·H − 5·A + 5
Nữ:   BMR = 10·W + 6.25·H − 5·A − 161

W = cân nặng (kg), H = chiều cao (cm), A = tuổi (năm)
```

**TDEE**

```
TDEE = BMR × hệ số vận động

SEDENTARY 1.200 · LIGHT 1.375 · MODERATE 1.550 · ACTIVE 1.725 · VERY_ACTIVE 1.900
```

**Mục tiêu năng lượng**

```
calorieTargetRaw = TDEE × (1 + hệ số hệ phái)

TANKER +0.10 · ASSASSIN −0.15 · SUPPORTER 0.00
```

**Guardrail an toàn** (xem §9.1 để biết lý do)

```
sàn = max(1200 nếu nữ | 1500 nếu nam,  BMR)
calorieTarget = max(calorieTargetRaw, sàn)
safetyClamped = (calorieTarget > calorieTargetRaw)
```

**Phân bổ macro**

```
proteinG = W × (2.0 nếu TANKER|ASSASSIN, 1.6 nếu SUPPORTER)
fatKcal  = calorieTarget × 0.25
fatG     = fatKcal / 9
carbsG   = (calorieTarget − proteinG×4 − fatKcal) / 4

Nếu carbsG < 50 → giảm proteinG xuống 1.6 g/kg và tính lại.
```

**Mục tiêu nước**

```
waterMl = clamp(W × 35, 1500, 4000)   // làm tròn đến 250 ml
```

**Đầu vào / đầu ra.** Đầu vào: `BiometricSnapshot` mới nhất + `archetype`. Đầu ra: một bản ghi `Prescription`. Hàm thuần túy, không hiệu ứng phụ — thuận tiện cho unit test.

---

### F-03 — Ánh xạ chỉ số nhân vật (StatMapper)

Bốn thanh trạng thái trên dashboard là **giá trị dẫn xuất, chỉ đọc** (nguyên tắc P1). Chúng được tính lại sau mỗi lần ghi nhận, không lưu như trạng thái độc lập.

| Thanh | Nguồn dữ liệu | Công thức |
|---|---|---|
| **Máu** (HP) | Nước + giấc ngủ + chuỗi | `40·(waterMl/target) + 40·(có bedtimeMarkedAt ? 1 : 0) + 20·min(streak/7, 1)` |
| **Năng lượng** (EN) | Cân bằng calo trong ngày | `100 − |caloriesIn − calorieTarget| / calorieTarget × 100`, kẹp 0–100 |
| **Sức mạnh** (STR) | Khối lượng kháng lực 7 ngày | `min(số phút RESISTANCE 7 ngày / 150, 1) × 100` |
| **Tốc độ** (SPD) | Khối lượng cardio 7 ngày | `min(số phút CARDIO+HIIT 7 ngày / 150, 1) × 100` |

**Quy tắc.**
- R-03.1 — Không có API nào cho phép ghi trực tiếp vào bốn giá trị này.
- R-03.2 — `perkPoints` nhận được khi lên cấp dùng để mở khóa **tiện ích** (thêm slot đổi món, mở khóa chủ đề, tăng trần vé đóng băng), **không** dùng để cộng vào bốn chỉ số trên.

> Đây là điểm sửa quan trọng so với bản nháp gốc: nếu điểm thuộc tính ảo cộng được vào chỉ số cơ thể, thì chỉ số cơ thể không còn phản ánh cơ thể.

---

### F-04 — Kê đơn dinh dưỡng

**Mô tả.** Sinh thực đơn ngày khớp mục tiêu năng lượng, có thể đổi từng món mà không phá vỡ tổng macro.

**Thuật toán sinh thực đơn**

1. Phân bổ calo theo bữa: sáng 25%, trưa 35%, tối 30%, phụ 10%.
2. Với mỗi bữa, truy vấn `MealPlan` có `kcal` trong khoảng ±12% hạn mức bữa và `mealSlot` khớp, lọc theo `tags` người dùng loại trừ.
3. Sắp xếp theo khoảng cách Euclid chuẩn hóa giữa macro món và macro mục tiêu của bữa; lấy ngẫu nhiên trong 5 kết quả gần nhất để hai ngày liên tiếp không trùng.
4. Nếu không đủ kết quả, nới dung sai lên ±20% rồi ±30%; vẫn không có thì trả về món gần nhất kèm cảnh báo lệch macro.

**Đổi món.** `POST /nutrition/swap` nhận `mealSlot`, trả về ứng viên kế tiếp trong danh sách đã xếp hạng, loại trừ các món đã hiện trong ngày. Giới hạn 3 lần đổi mỗi bữa mỗi ngày (nâng lên 5 nếu đã mở khóa perk tương ứng).

**Ghi nhận.** `POST /nutrition/log` cộng `caloriesIn` vào `DailyLog`. Cho phép nhập tay số calo cho món ngoài thư viện.

---

### F-05 — Kê đơn tập luyện và Chế độ tập trung

**Bộ lọc bài tập.** Người dùng lọc theo `durationSec` (5 / 15 / 30 / 45 phút), `spaceNeeded` (cạnh bàn / trong phòng / phòng gym / ngoài trời), `equipment`. Hệ thống ưu tiên bài có `archetypes` chứa hệ phái người dùng.

**Chế độ tập trung (Focus Mode).** Khi bấm bắt đầu:

1. Lớp phủ toàn màn hình che dashboard (`role="dialog"`, `aria-modal="true"`, bẫy tiêu điểm bàn phím).
2. Hiển thị video/ảnh động bài tập, tên bài, số hiệp còn lại.
3. Bộ đếm ngược chạy theo `durationSec`; đếm dựa trên `performance.now()` chứ không dựa trên số lần `setInterval` chạy, để không lệch khi tab bị throttle.
4. Nhạc nền chỉ phát **sau thao tác bấm của người dùng** — trình duyệt chặn autoplay có âm thanh. Nút bật/tắt nhạc luôn hiển thị.
5. Gọi Screen Wake Lock API để màn hình không tắt giữa buổi tập; nếu trình duyệt không hỗ trợ thì bỏ qua, không báo lỗi.
6. Phím `Esc` hoặc nút Thoát mở hộp thoại xác nhận, tránh mất tiến trình do bấm nhầm.
7. Kết thúc buổi tập → `POST /workout/complete` với `exerciseItemId` và `elapsedSec` thực tế.

**Quy tắc.**
- R-05.1 — `elapsedSec` dưới 50% `durationSec` được ghi nhận là buổi tập dở, cộng XP theo tỉ lệ, không tính là hoàn thành nhiệm vụ cốt truyện.
- R-05.2 — Người dùng bật `prefers-reduced-motion` sẽ không thấy hiệu ứng chuyển cảnh; nội dung và bộ đếm giữ nguyên.

---

### F-06 — Bảng nhiệm vụ ngày (Daily Quest Board)

Ba phân loại nhiệm vụ, đúng như bản gốc nhưng có định nghĩa điều kiện rõ ràng:

| Loại | Ví dụ | Ảnh hưởng chuỗi ngày | XP | Xu |
|---|---|---|---|---|
| **Cốt truyện** (STORY) | Hoàn thành buổi tập chính; nạp calo trong khoảng ±10% mục tiêu | Có — cả hai phải xong thì chuỗi mới tăng | 50 / nhiệm vụ | 20 |
| **Hằng ngày** (DAILY) | Uống đủ 8 ly nước; đứng dậy vươn vai mỗi 60 phút | Không | 10 / lần tick | 5 |
| **Ẩn** (HIDDEN) | Bấm "Kết thúc ngày" trước 23:00 giờ địa phương | Không | 30 | 15 + phần thưởng mở hôm sau |

**Nhiệm vụ uống nước.** Tám ô tương ứng tám phần nước (`targetCount = 8`). Mỗi lần bấm tăng `QuestCompletion.progress` lên 1 và cộng `waterMl` vào `DailyLog`. Bấm nhầm có thể hoàn tác trong 5 giây (nút Hoàn tác, không phải hộp thoại). Hiệu ứng âm thanh tắt được trong cài đặt và mặc định tắt nếu hệ thống báo `prefers-reduced-motion`.

**Nhiệm vụ đứng dậy.** Bộ hẹn giờ 60 phút chạy trên client khi tab đang hiển thị; khi tab ẩn quá 10 phút thì tạm dừng thay vì tiếp tục đếm. Đến hạn thì gửi thông báo trong ứng dụng; chỉ gửi Web Push nếu người dùng đã cấp quyền và đang không ở trong tab.

**Nhiệm vụ ẩn — phát hiện giờ ngủ.**

> **Thay đổi so với bản gốc.** Bản gốc dùng "người dùng tắt ứng dụng trước 23:00" làm tín hiệu đi ngủ. Tín hiệu này không đáng tin: đóng tab, mất mạng, sập máy, hay chỉ chuyển sang tab khác đều tạo cùng một sự kiện, và trình duyệt không đảm bảo chạy handler khi đóng tab. Thay vào đó hệ thống dùng một **hành động chủ động**: nút "Kết thúc ngày", ghi `bedtimeMarkedAt`. Người dùng bấm rồi vẫn dùng máy tiếp cũng không sao — hệ thống ghi nhận ý định, không giám sát hành vi.

---

### F-07 — Điểm kinh nghiệm và cấp độ

**Ngưỡng XP.** Tăng theo hàm mũ nhẹ để cấp đầu nhanh, cấp sau chậm dần:

```
xpCần(level) = round(100 × level^1.5)

L1→L2:  100     L5→L6:  1.118
L2→L3:  283     L10→L11: 3.162
L3→L4:  520     L20→L21: 8.944
```

**Danh hiệu.**

| Cấp | Danh hiệu |
|---|---|
| 1–4 | Tân binh |
| 5–9 | Người kiên trì |
| 10–19 | Chiến binh kỷ luật |
| 20–34 | Kiện tướng |
| 35+ | Huyền thoại thể hình |

> **Thay đổi so với bản gốc.** Các danh hiệu cấp thấp trong bản gốc ("Kẻ lười biếng tập sự", "Chúa tể ngủ nướng") đã được thay. Trong một ứng dụng sức khỏe, gán nhãn tiêu cực cho người dùng ở đúng giai đoạn họ dễ bỏ cuộc nhất là phản tác dụng, và với người có vấn đề về hình ảnh cơ thể thì còn có hại (nguyên tắc P2). Chất hài hước nên nằm ở nội dung linh vật và câu thông báo, không nằm ở nhãn dán lên người dùng.

**Khi lên cấp.** Cộng `perkPoints += 1`, mở khóa các mục cửa hàng có `minLevel` tương ứng, hiển thị hoạt ảnh (bỏ qua nếu `prefers-reduced-motion`).

**Chống gian lận.** Toàn bộ dữ liệu là tự khai báo — đây là hệ thống danh dự và tài liệu này thừa nhận điều đó. Biện pháp duy nhất áp dụng là **giới hạn tần suất ghi** (tối đa 1 lần hoàn thành mỗi nhiệm vụ mỗi ngày logic, cưỡng chế bằng ràng buộc `@@unique`), đủ để chặn lỗi lặp request chứ không nhằm chặn người dùng cố tình khai khống.

---

### F-08 — Thuật toán chuỗi ngày (StreakEngine)

**Điều kiện tăng chuỗi.** Tất cả nhiệm vụ `STORY` của ngày logic phải hoàn thành trước khi ngày logic đóng.

**Ngày logic.** Xem §6.1. Điểm chính: ngày logic đóng lúc **03:00 giờ địa phương của người dùng**, không phải 00:00.

> **Thay đổi so với bản gốc.** Bản gốc reset chuỗi lúc 00:00. Người dùng mục tiêu là người ngồi máy tính khuya; với họ 23:50 vẫn là "hôm nay". Mốc 00:00 tạo ra hàng loạt lần mất chuỗi mà người dùng cảm thấy oan, và cảm giác oan là nguyên nhân rời bỏ mạnh hơn cả sự lười. Mốc 03:00 giữ nguyên áp lực nhưng bỏ đi phần bất công. Ngoài ra bản gốc không nêu múi giờ nào được dùng — với người dùng ở nhiều múi giờ thì đây là lỗi đúng đắn dữ liệu, không phải chi tiết nhỏ.

**Máy trạng thái chuỗi**

```
                 đủ nhiệm vụ STORY
   ┌──────────┐ ────────────────────▶ streak += 1
   │ Ngày mở  │
   └──────────┘ ─── thiếu ────┐
                              ▼
                      có vé đóng băng chưa dùng?
                       ├─ có  → dùng vé, streak giữ nguyên, ghi usedForDate
                       └─ không → streak = 0
```

**Hiệu ứng.** Chuỗi ≥ 3 hiển thị biểu tượng ngọn lửa; mốc 7 / 30 / 100 ngày trao huy hiệu vào `Inventory`. `streakBest` không bao giờ giảm — người dùng luôn giữ được kỷ lục cá nhân kể cả sau khi đứt chuỗi.

---

### F-09 — Linh vật (PetStateMachine)

Bản gốc gộp "tiến hóa" và "tâm trạng" vào một trục, dẫn đến hệ quả là bỏ tập vài ngày thì linh vật thoái hóa. Tài liệu này **tách làm hai trục độc lập**.

**Trục 1 — Giai đoạn tiến hóa (một chiều, không lùi)**

```
EGG ──(growth 100)──▶ HATCHLING ──▶ JUVENILE ──▶ ADULT ──▶ MYTHIC
```

`growth` tăng theo XP tích lũy trong giai đoạn. Đã tiến hóa thì không lùi. Lý do: đây là phần thưởng ghi nhận công sức đã bỏ ra; thu hồi phần thưởng đã trao là cơ chế trừng phạt hiệu quả trong game cạnh tranh nhưng phản tác dụng trong ứng dụng hành vi.

**Trục 2 — Tâm trạng (hai chiều, có sàn)**

| Điều kiện | Tâm trạng |
|---|---|
| Chuỗi ≥ 3 và hoàn thành nhiệm vụ STORY hôm qua | `HAPPY` |
| Trường hợp còn lại | `NEUTRAL` |
| Bỏ lỡ nhiệm vụ STORY ≥ 3 ngày liên tiếp | `TIRED` |

`TIRED` là đáy. Không có trạng thái "ốm", "bệnh" hay "sắp chết". Linh vật ở `TIRED` hiển thị buồn ngủ và một dòng thoại mời quay lại, không trách móc.

---

### F-10 — Kinh tế ảo và cửa hàng

**Nguồn thu xu.** Hoàn thành nhiệm vụ (bảng ở F-06), mốc chuỗi ngày, thứ hạng tổ đội cuối tuần.

**Chi tiêu.** Chủ đề giao diện (`Cyberpunk Neon`, `Minimalist Forest`, `Paper Light`…), trang phục linh vật, huy hiệu hồ sơ.

**Ràng buộc.**
- R-10.1 — Mọi mục cửa hàng đều là **thẩm mỹ**. Không có mục nào mua được ảnh hưởng đến XP, chuỗi ngày hay điểm tổ đội — nếu có thì bảng xếp hạng mất ý nghĩa.
- R-10.2 — Mua hàng ghi hai bút toán trong cùng một transaction: `CoinLedger` (âm) và `Inventory` (thêm). Số dư xu = `SUM(CoinLedger.amount)`, không lưu như một trường có thể lệch.
- R-10.3 — Không có giao dịch tiền thật ở MVP.

---

### F-11 — Tổ đội và bảng xếp hạng

**Cấu trúc.** Tổ đội gồm 3–8 thành viên (bản gốc giới hạn 3–5; mở rộng để nhóm bạn học không phải chia đôi). Vào tổ đội bằng mã mời. Một người dùng thuộc tối đa một tổ đội.

**Cách tính điểm.**

```
đóng góp(thành viên, ngày) = số nhiệm vụ STORY hoàn thành / tổng nhiệm vụ STORY

avgCompletion(guild, tuần) =
    trung bình cộng đóng góp của các thành viên hoạt động, trên 7 ngày
```

> **Thay đổi so với bản gốc.** Bản gốc tính điểm tổ đội bằng **tổng** điểm cá nhân. Cách đó khiến tổ đội đông người luôn thắng tổ đội ít người bất kể mức độ chăm chỉ, và bảng xếp hạng trở thành cuộc thi tuyển quân. Dùng **tỉ lệ hoàn thành trung bình** khiến một nhóm 3 người kỷ luật có thể thắng một nhóm 8 người lơ là — đúng với thứ mà sản phẩm muốn thưởng.

**Thành viên hoạt động.** Là thành viên có ít nhất một `DailyLog` trong tuần. Tổ đội có dưới 3 thành viên hoạt động không lên bảng xếp hạng (tránh lập tổ đội một người để chiếm hạng nhất).

**Chu kỳ.** Tuần bắt đầu thứ Hai 00:00 `Asia/Ho_Chi_Minh`. Job `weekly-rollover` chạy lúc thứ Hai 03:30 để chốt tuần trước và trao thưởng.

**Độ tươi của bảng xếp hạng.** Bản gốc gọi đây là bảng xếp hạng thời gian thực nhưng lại tính theo chu kỳ tuần — hai điều này mâu thuẫn. Thực tế: bảng xếp hạng **cập nhật gần thời gian thực**, làm mới cache Redis mỗi 5 phút; kết quả tuần được chốt cứng vào `GuildWeeklyScore` khi tuần đóng. Giao diện hiển thị rõ "cập nhật lúc HH:mm".

---

### F-12 — Nhắc nhở (Nudge)

**Mô tả.** Thành viên tổ đội gửi một lời nhắc vui đến đồng đội chưa hoàn thành nhiệm vụ trong ngày.

**Ràng buộc chống lạm dụng** (bản gốc không có ràng buộc nào, và một nút gửi thông báo đẩy không giới hạn là một công cụ quấy rối):

- R-12.1 — Chỉ gửi được trong cùng tổ đội.
- R-12.2 — Chỉ gửi được từ **12:00 đến 20:00** giờ địa phương của **người nhận**.
- R-12.3 — Người nhận nhận tối đa **1 lời nhắc mỗi ngày**, từ bất kỳ ai.
- R-12.4 — Người gửi gửi tối đa **3 lời nhắc mỗi ngày**.
- R-12.5 — Nội dung chọn từ **danh sách mẫu cố định**, không nhập tự do. Loại bỏ hoàn toàn khả năng dùng tính năng này để gửi lời lẽ xúc phạm.
- R-12.6 — Người dùng tắt nhận nhắc nhở bất cứ lúc nào; khi tắt, nút gửi hiển thị mờ với chú thích "Thành viên này đã tắt nhắc nhở".

**Kênh gửi.** Web Push nếu người dùng đã cấp quyền, nếu không thì thông báo trong ứng dụng ở lần mở kế tiếp. Lưu ý kỹ thuật: Web Push trên Safari/iOS chỉ hoạt động khi trang đã được thêm vào màn hình chính — giao diện phải xử lý được trường hợp gửi mà không đến nơi.

---

### F-13 — Góc giải tỏa và vé đóng băng

**Mô tả.** Ô nhập văn bản tự do để người dùng viết ra áp lực trong ngày. Hệ thống trả về một câu trích dẫn từ thư viện có sẵn.

**Quy tắc.**
- R-13.1 — Nội dung nhật ký **chỉ người viết đọc được**. Không chia sẻ trong tổ đội, không hiển thị ở bất kỳ đâu khác, không dùng làm dữ liệu huấn luyện.
- R-13.2 — MVP **không** phân tích cảm xúc bằng AI. Câu trích dẫn chọn ngẫu nhiên có loại trừ các câu đã trả về trong 30 ngày gần nhất. Phân tích nội dung tâm lý của người dùng là hạng mục cần cân nhắc riêng, không phải một tính năng phụ.
- R-13.3 — Nếu văn bản khớp danh sách từ khóa cảnh báo khủng hoảng, giao diện hiển thị thêm một khối thông tin đường dây hỗ trợ tâm lý, đặt cạnh phản hồi bình thường chứ không thay thế nó. Không ghi log sự kiện này, không thông báo cho ai.

**Vé đóng băng (Freeze Ticket).**

> **Thay đổi so với bản gốc.** Bản gốc cấp vé mỗi lần người dùng viết nhật ký. Vì viết nhật ký không giới hạn số lần, người dùng có thể tích vé vô hạn và chuỗi ngày mất sạch ý nghĩa (nguyên tắc P3). Cơ chế dưới đây giữ nguyên tinh thần "hệ thống hiểu bạn có ngày tệ" nhưng làm cho sự tha thứ trở nên khan hiếm.

- Cấp tối đa **1 vé mỗi tuần lịch**, cấp khi người dùng viết nhật ký lần đầu trong tuần đó.
- Tồn kho tối đa **2 vé** (3 nếu đã mở khóa perk tương ứng). Vé thứ ba trở đi không được cấp.
- Dùng vé đóng băng chuỗi ngày trong 24 giờ: chuỗi giữ nguyên, không tăng, không reset.
- Vé dùng được **cho ngày hiện tại hoặc ngày logic vừa đóng trong vòng 12 giờ** — cho phép cứu chuỗi vào sáng hôm sau, nhưng không cho phép hồi tố cả tuần.
- Viết nhật ký luôn cộng 15 XP, kể cả khi không được cấp vé. Hành động viết ra tự nó đáng ghi nhận.

---

## 6. Quy tắc nghiệp vụ xuyên suốt

### 6.1. Ngày logic và múi giờ

**Định nghĩa.** Ngày logic của một người dùng là khoảng thời gian từ **03:00 hôm nay đến 02:59:59 hôm sau**, tính theo `User.timezone`.

**Hệ quả.**
- Hành động lúc 01:30 ngày 10/09 thuộc về ngày logic **09/09**.
- `DailyLog.logicalDate` lưu kiểu `DATE`, không kiểu `TIMESTAMP` — nó là một nhãn ngày, không phải một thời điểm.
- Đổi múi giờ trong hồ sơ **không** tính lại các `DailyLog` cũ. Ngày đã đóng thì đóng vĩnh viễn.
- Ngoại lệ: nhiệm vụ ẩn "kết thúc ngày trước 23:00" dùng **giờ đồng hồ thật**, không dùng mốc ngày logic — vì mục tiêu của nó là giờ đi ngủ thực tế.

### 6.2. Tác vụ nền theo lịch

| Job | Tần suất | Việc |
|---|---|---|
| `day-close` | Mỗi giờ, phút thứ 15 | Tìm `DailyLog` có `logicalDate` đã qua mốc 03:00 tại múi giờ của chủ sở hữu và `closedAt IS NULL`; chạy StreakEngine, PetStateMachine; đặt `closedAt` |
| `weekly-rollover` | Thứ Hai 03:30 ICT | Tổng hợp `GuildWeeklyScore`, xếp hạng, trao thưởng xu và huy hiệu |
| `reminder-dispatch` | Mỗi 15 phút | Gửi nhắc nhở nhiệm vụ đến người dùng đã bật thông báo, trong khung giờ họ chọn |
| `ticket-grant` | Mỗi giờ | Kiểm tra điều kiện cấp vé đóng băng tuần |

Mọi job phải **idempotent**: chạy lại cùng một khoảng thời gian không được tạo hiệu ứng lần hai. Cưỡng chế bằng cột `closedAt` và các ràng buộc `@@unique` trên sổ cái.

### 6.3. Idempotency của API ghi

Mọi endpoint ghi nhận hành vi nhận header `Idempotency-Key`. Khóa mặc định do client sinh theo `{userId}:{questId}:{logicalDate}`. Gửi trùng trả về `200` với trạng thái hiện tại, không tạo bút toán mới. Ràng buộc `@@unique([userId, reason, refId])` trên `XpLedger` là lớp bảo vệ cuối cùng ở tầng CSDL.

---

## 7. Giao diện API

Tất cả endpoint đặt dưới `/api/v1`, yêu cầu session hợp lệ trừ khi ghi chú khác.

### Hồ sơ và đơn kê

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/onboarding` | Tạo hồ sơ, snapshot đầu tiên, đơn kê, linh vật |
| `GET` | `/me` | Hồ sơ + tiến trình + chỉ số nhân vật đã tính |
| `POST` | `/me/biometrics` | Thêm snapshot mới, tính lại đơn kê |
| `PATCH` | `/me/archetype` | Đổi hệ phái (chịu cooldown 14 ngày) |
| `GET` | `/me/prescription` | Đơn kê hiện hành |

### Ngày và nhiệm vụ

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/day` | `DailyLog` của ngày logic hiện tại kèm danh sách nhiệm vụ |
| `POST` | `/day/quests/{questId}/progress` | Tăng tiến độ (ví dụ tick một ly nước) |
| `POST` | `/day/quests/{questId}/undo` | Hoàn tác trong cửa sổ 5 giây |
| `POST` | `/day/bedtime` | Ghi `bedtimeMarkedAt` |
| `GET` | `/day/history?from=&to=` | Lịch sử cho biểu đồ |

### Dinh dưỡng và tập luyện

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/nutrition/plan` | Thực đơn ngày đã sinh |
| `POST` | `/nutrition/swap` | Đổi món một bữa |
| `POST` | `/nutrition/log` | Ghi calo nạp vào |
| `GET` | `/workout/catalog?duration=&space=` | Danh sách bài tập đã lọc |
| `POST` | `/workout/complete` | Ghi buổi tập hoàn thành |

### Tiến trình và cửa hàng

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/progression` | XP, cấp, chuỗi, xu, perkPoints |
| `GET` | `/pet` | Trạng thái linh vật |
| `GET` | `/shop` | Danh mục kèm cờ đã sở hữu |
| `POST` | `/shop/{itemId}/purchase` | Mua (transaction) |
| `POST` | `/inventory/{itemId}/equip` | Trang bị chủ đề hoặc trang phục |

### Tổ đội

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/guilds` | Tạo tổ đội |
| `POST` | `/guilds/join` | Vào bằng mã mời |
| `GET` | `/guilds/me` | Tổ đội hiện tại + tiến độ thành viên hôm nay |
| `GET` | `/leaderboard?week=` | Bảng xếp hạng tuần |
| `POST` | `/guilds/nudge` | Gửi nhắc nhở (chịu các ràng buộc R-12.x) |

### Góc giải tỏa

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/journal` | Ghi nhật ký, trả về câu trích dẫn và trạng thái cấp vé |
| `GET` | `/journal?limit=` | Nhật ký của chính mình |
| `GET` | `/freeze-tickets` | Tồn kho vé |
| `POST` | `/freeze-tickets/use` | Dùng vé cho một ngày logic |

**Định dạng lỗi.** Toàn hệ thống dùng một hình dạng:

```json
{
  "error": {
    "code": "ARCHETYPE_COOLDOWN",
    "message": "Bạn có thể đổi hệ phái sau 9 ngày nữa.",
    "details": { "availableAt": "2026-09-18T00:00:00+07:00" }
  }
}
```

---

## 8. Yêu cầu phi chức năng

| Mã | Hạng mục | Yêu cầu |
|---|---|---|
| NFR-01 | Hiệu năng | p95 thời gian phản hồi API < 300 ms; bảng xếp hạng < 500 ms (có cache) |
| NFR-02 | Cảm giác tức thời | Mọi thao tác tick nhiệm vụ cập nhật giao diện ngay (optimistic), hoàn nguyên kèm thông báo nếu server từ chối |
| NFR-03 | Chịu lỗi mạng | Thao tác tick khi mất mạng được xếp hàng trong IndexedDB và gửi lại khi có mạng |
| NFR-04 | Khả năng tiếp cận | WCAG 2.1 AA: tương phản ≥ 4.5:1, mọi thao tác dùng được bằng bàn phím, trạng thái không chỉ mã hóa bằng màu (thanh chỉ số kèm số, ô nước kèm nhãn) |
| NFR-05 | Chuyển động | Tôn trọng `prefers-reduced-motion` cho toàn bộ hoạt ảnh lên cấp, tiến hóa, ngọn lửa |
| NFR-06 | Âm thanh | Mặc định tắt; chỉ phát sau thao tác của người dùng; luôn có nút tắt |
| NFR-07 | Thiết bị | Ưu tiên di động (mobile-first); dashboard dùng được ở bề rộng 360 px |
| NFR-08 | Ngôn ngữ | Tiếng Việt là ngôn ngữ mặc định; chuỗi hiển thị tách khỏi mã nguồn để mở đường quốc tế hóa |
| NFR-09 | Kiểm thử | Bao phủ ≥ 90% cho `EnergyCalculator`, `StreakEngine`, `StatMapper`, `GuildScorer` — đây là các hàm thuần túy, không có lý do gì để không test kỹ |
| NFR-10 | Quan trắc | Log có cấu trúc cho mọi bút toán sổ cái; cảnh báo khi `day-close` không chạy đúng lịch |

---

## 9. An toàn sức khỏe và đạo đức sản phẩm

### 9.1. Guardrail năng lượng

Một hệ thống game hóa thưởng cho việc bám sát mục tiêu calo sẽ thưởng cho việc bám sát một mục tiêu sai nếu mục tiêu đó được tính sai. Vì vậy:

- **Sàn tuyệt đối:** 1.200 kcal/ngày (nữ), 1.500 kcal/ngày (nam), và không bao giờ thấp hơn BMR.
- **Trần thâm hụt:** tối đa 20% dưới TDEE, bất kể hệ phái.
- Khi guardrail can thiệp, đặt `Prescription.safetyClamped = true` và hiển thị một dòng giải thích ngắn cho người dùng, không giấu.
- Người dùng có BMI < 18,5 không được chọn cấu hình giảm mỡ; giao diện chuyển hướng sang hệ Đỡ Đòn hoặc Hỗ Trợ kèm giải thích.

### 9.2. Miễn trừ trách nhiệm

Hiển thị ở cuối onboarding và trong phần cài đặt: QUEST cung cấp ước tính dựa trên công thức dân số học phổ biến, không phải tư vấn y tế cá nhân hóa, và không thay thế ý kiến của bác sĩ hay chuyên gia dinh dưỡng.

### 9.3. Không đo cân nặng bắt buộc

Không có nhiệm vụ nào yêu cầu cân hằng ngày và không có cơ chế thưởng nào gắn với việc giảm cân. Cân nặng chỉ là đầu vào để tính năng lượng. Lý do: thưởng cho con số trên cân là cách nhanh nhất để một ứng dụng sức khỏe trở thành một ứng dụng gây hại cho người có vấn đề về ăn uống.

### 9.4. Ngôn ngữ

Toàn bộ chuỗi hiển thị tránh nhãn tiêu cực về người dùng, so sánh cơ thể, và ngôn ngữ đạo đức hóa thức ăn ("đồ ăn bẩn", "tội lỗi"). Danh sách từ cấm được duy trì cùng file ngôn ngữ.

---

## 10. Quyền riêng tư và bảo mật

### 10.1. Phân loại dữ liệu

| Mức | Dữ liệu | Xử lý |
|---|---|---|
| Nhạy cảm cao | Nội dung nhật ký | Mã hóa ở tầng ứng dụng (AES-256-GCM, khóa trong KMS/biến môi trường), không đánh chỉ mục nội dung, không log |
| Nhạy cảm | Chiều cao, cân nặng, tuổi, giới tính | Chỉ chủ tài khoản đọc; không xuất hiện trong bất kỳ API tổ đội nào |
| Nội bộ | XP, cấp, chuỗi, tỉ lệ hoàn thành | Thành viên tổ đội thấy được tỉ lệ hoàn thành và cấp độ, không thấy chỉ số cơ thể |
| Công khai | Tên hiển thị, huy hiệu | — |

### 10.2. Quy tắc

- R-P.1 — Endpoint tổ đội **không bao giờ** trả về `weightKg`, `heightCm`, `calorieTarget`, `caloriesIn` của người khác.
- R-P.2 — Xóa tài khoản là xóa mềm (`deletedAt`) rồi xóa cứng sau 30 ngày, xóa lan (`onDelete: Cascade`) toàn bộ dữ liệu liên quan.
- R-P.3 — Người dùng tải về toàn bộ dữ liệu của mình dưới dạng JSON bất cứ lúc nào.
- R-P.4 — Không có bên thứ ba nào nhận dữ liệu sinh học. Công cụ phân tích chỉ nhận sự kiện ẩn danh (mở màn hình, hoàn thành nhiệm vụ) không kèm giá trị số đo.
- R-P.5 — Rate limit theo IP và theo tài khoản trên mọi endpoint ghi; giới hạn nghiêm ngặt hơn trên `/guilds/nudge` và `/journal`.

---

## 11. Lộ trình triển khai

### Giai đoạn 0 — Nền móng (tuần 1)

Khởi tạo dự án, lược đồ CSDL, xác thực, seed thư viện bài tập và thực đơn (tối thiểu 40 món, 30 bài tập).

### Giai đoạn 1 — Vòng lặp cốt lõi (tuần 2–3) → *bản dùng được đầu tiên*

F-01 Onboarding · F-02 EnergyCalculator · F-03 StatMapper · F-06 Bảng nhiệm vụ · F-07 XP & cấp · F-08 Chuỗi ngày · job `day-close`.

**Tiêu chí ra mắt nội bộ:** một người dùng đăng ký, nhận mục tiêu, tick nhiệm vụ ba ngày liên tiếp và thấy chuỗi tăng đúng qua mốc nửa đêm.

### Giai đoạn 2 — Nội dung và cảm giác (tuần 4–5)

F-04 Kê đơn dinh dưỡng · F-05 Tập luyện + Chế độ tập trung · F-09 Linh vật · F-10 Cửa hàng.

### Giai đoạn 3 — Xã hội (tuần 6–7)

F-11 Tổ đội và bảng xếp hạng · F-12 Nhắc nhở · job `weekly-rollover`.

### Giai đoạn 4 — Nhân văn và hoàn thiện (tuần 8)

F-13 Góc giải tỏa và vé đóng băng · rà soát khả năng tiếp cận · rà soát quyền riêng tư · tài liệu.

### Sau v1

Đồng bộ thiết bị đeo · ứng dụng PWA cài đặt được · nhiệm vụ theo mùa · tổ đội tự tạo nhiệm vụ riêng.

---

## 12. Tiêu chí thành công

| Mã | Chỉ số | Ngưỡng |
|---|---|---|
| M-01 | Tỉ lệ hoàn tất onboarding | > 70% người bắt đầu |
| M-02 | Quay lại ngày kế tiếp (D1) | > 40% |
| M-03 | Quay lại sau 7 ngày (D7) | > 20% |
| M-04 | Chuỗi ngày trung vị của người dùng hoạt động | ≥ 4 |
| M-05 | Tỉ lệ người dùng thuộc một tổ đội | > 35% |
| M-06 | Thời gian trung vị để ghi nhận xong một ngày | < 60 giây |
| M-07 | Tỉ lệ đơn kê bị guardrail can thiệp | Theo dõi; nếu > 15% thì công thức hoặc form đầu vào có vấn đề |

---

## 13. Rủi ro và giả định

| # | Rủi ro | Ảnh hưởng | Cách giảm thiểu |
|---|---|---|---|
| 1 | Dữ liệu tự khai báo không chính xác | Chỉ số nhân vật mất ý nghĩa với người khai khống | Chấp nhận. Sản phẩm dành cho người muốn tiến bộ; gian lận chỉ hại chính họ. Bảng xếp hạng dùng tỉ lệ hoàn thành, không dùng số đo |
| 2 | Thư viện nội dung quá mỏng | Người dùng gặp lại cùng thực đơn sau vài ngày và chán | Ngưỡng seed tối thiểu ở Giai đoạn 0; theo dõi tỉ lệ trùng lặp thực đơn 7 ngày |
| 3 | Web Push không tin cậy trên iOS | Nhắc nhở không đến nơi | Luôn có bản sao thông báo trong ứng dụng; không thiết kế tính năng nào phụ thuộc hoàn toàn vào push |
| 4 | Tổ đội "chết" làm giảm động lực | Người dùng ở nhóm không hoạt động thấy bảng xếp hạng vô nghĩa | Tự động đánh dấu tổ đội không hoạt động sau 14 ngày và gợi ý tìm nhóm mới |
| 5 | Cơ chế chuỗi ngày tạo áp lực ngược | Người dùng lo lắng vì sợ mất chuỗi | Vé đóng băng, `streakBest` không giảm, ngôn ngữ không trách móc, tùy chọn ẩn hiển thị chuỗi trong cài đặt |
| 6 | Sai lệch múi giờ trong job nền | Chuỗi ngày reset sai, mất niềm tin | Test tích hợp riêng cho ranh giới ngày logic ở nhiều múi giờ, bao gồm cả trường hợp đổi giờ mùa |
| 7 | Phạm vi quá rộng cho một người làm | Không kịp hoàn thành | Giai đoạn 1 là bản dùng được độc lập; các giai đoạn sau cắt được mà sản phẩm vẫn đứng vững |

**Giả định.**

- Người dùng sẵn lòng nhập tay dữ liệu ăn uống ít nhất trong giai đoạn đầu (chưa có tích hợp thiết bị).
- Nội dung thực đơn và bài tập do nhóm dự án tự biên soạn hoặc lấy từ nguồn có giấy phép phù hợp.
- Quy mô ban đầu dưới 10.000 người dùng — một instance PostgreSQL là đủ.

---

## Phụ lục A — Bảng thuật ngữ

| Thuật ngữ | Định nghĩa trong tài liệu này |
|---|---|
| **BMR** | Basal Metabolic Rate — năng lượng cơ thể tiêu thụ khi nghỉ hoàn toàn |
| **TDEE** | Total Daily Energy Expenditure — BMR nhân hệ số vận động |
| **Hệ phái** (Archetype) | Bộ lọc nội dung và trọng số mục tiêu; không phải lớp nhân vật có chỉ số riêng |
| **Ngày logic** | Khoảng 03:00 → 02:59:59 hôm sau tại múi giờ người dùng (§6.1) |
| **Nhiệm vụ cốt truyện** | Nhiệm vụ bắt buộc quyết định chuỗi ngày có tăng hay không |
| **Sổ cái** (Ledger) | Bảng chỉ ghi thêm; giá trị hiện tại là tổng các bút toán |
| **Vé đóng băng** | Vật phẩm giữ nguyên chuỗi ngày trong 24 giờ, khan hiếm theo thiết kế |
| **Perk point** | Điểm mở khóa tiện ích khi lên cấp; không cộng vào chỉ số cơ thể |
| **Idempotent** | Thực thi nhiều lần cho cùng kết quả như thực thi một lần |

---

## Phụ lục B — Thay đổi so với bản nháp gốc

### B.1. Lỗ hổng nghiệp vụ đã sửa

| # | Vấn đề trong bản gốc | Xử lý |
|---|---|---|
| 1 | Chuỗi ngày reset lúc 00:00, không nêu múi giờ | Đưa ra khái niệm ngày logic đóng lúc 03:00 giờ địa phương; lưu `timezone` trong hồ sơ (§6.1, F-08) |
| 2 | Phát hiện giờ ngủ bằng việc "tắt ứng dụng" | Thay bằng hành động chủ động "Kết thúc ngày" — tín hiệu đóng tab không đáng tin trên web (F-06) |
| 3 | Vé đóng băng cấp không giới hạn qua nhật ký | Giới hạn 1 vé/tuần, tồn kho tối đa 2, cửa sổ dùng 12 giờ (F-13) |
| 4 | Điểm tổ đội = tổng điểm cá nhân | Đổi sang tỉ lệ hoàn thành trung bình, yêu cầu ≥ 3 thành viên hoạt động (F-11) |
| 5 | Nút nhắc nhở không có giới hạn | Sáu ràng buộc chống lạm dụng, nội dung từ mẫu cố định (F-12) |
| 6 | "Bảng xếp hạng thời gian thực" nhưng chu kỳ tuần | Làm rõ: cache làm mới 5 phút, kết quả tuần chốt cứng (F-11) |
| 7 | Điểm thuộc tính khi lên cấp cộng vào chỉ số nhân vật | Tách thành `perkPoints` mở khóa tiện ích; chỉ số cơ thể là giá trị dẫn xuất chỉ đọc (F-03, P1) |
| 8 | Không có ngưỡng an toàn cho mục tiêu calo | Guardrail sàn 1.200/1.500 kcal, trần thâm hụt 20%, chặn cấu hình giảm mỡ khi BMI < 18,5 (§9.1) |
| 9 | Danh hiệu miệt thị người dùng cấp thấp | Thay bằng thang danh hiệu trung tính đến tích cực (F-07, P2) |
| 10 | Linh vật thoái hóa khi người dùng sa sút | Tách hai trục: tiến hóa một chiều, tâm trạng có sàn `TIRED` (F-09) |
| 11 | Bốn thanh trạng thái không có công thức | Định nghĩa công thức cho từng thanh từ dữ liệu hành vi (F-03) |
| 12 | Không xử lý chính sách autoplay của trình duyệt | Nhạc chỉ phát sau thao tác người dùng; thêm Wake Lock, bẫy tiêu điểm, hoàn tác (F-05) |
| 13 | Không đề cập hệ phái có đổi được không | Cho đổi, cooldown 14 ngày, không mất tiến trình (R-01.1) |
| 14 | Không có chống ghi trùng | Sổ cái append-only, ràng buộc `@@unique`, `Idempotency-Key` (§6.3) |

### B.2. Phần bổ sung hoàn toàn mới

Mô hình dữ liệu (§4) · Giao diện API (§7) · Yêu cầu phi chức năng (§8) · An toàn sức khỏe (§9) · Quyền riêng tư và bảo mật (§10) · Lộ trình phân giai đoạn (§11) · Tiêu chí thành công (§12) · Rủi ro và giả định (§13).

### B.3. Về thuật ngữ

Bản gốc gắn nhãn tiếng Anh cho nhiều thao tác thông thường theo cách không khớp nghĩa kỹ thuật thật:

| Bản gốc | Vấn đề | Trong tài liệu này |
|---|---|---|
| "Input Parameter Tuning" | *Tuning* là tinh chỉnh siêu tham số mô hình, không phải điền form | Onboarding và khởi tạo hồ sơ |
| "Array Component" (8 ly nước) | Không phải một khái niệm; chỉ là mảng trạng thái | `QuestCompletion.progress` với `targetCount = 8` |
| "Search Query" (tìm thực đơn) | Đây là truy vấn lọc theo khoảng, không phải tìm kiếm | Bộ lọc theo khoảng + xếp hạng theo khoảng cách macro |
| "Data Filtering & Logic Optimization" | Không mô tả điều gì cụ thể | EnergyCalculator + PrescriptionEngine |
| "Model hiển thị" (linh vật) | *Model* trong ngữ cảnh này gây nhầm với mô hình dữ liệu | Sprite / asset theo `PetStage` |
| "Nudge API Trigger" | Gọi API không phải là một tính năng để mô tả | Tính năng nhắc nhở, kèm ràng buộc tần suất |

Một tài liệu đặc tả tốt được đánh giá bằng việc lập trình viên đọc xong có xây được đúng thứ cần xây hay không, chứ không bằng mật độ thuật ngữ. Toàn bộ tài liệu này ưu tiên câu mô tả chính xác điều gì xảy ra, khi nào, và với dữ liệu nào.

---

*Kết thúc tài liệu SPEC-QUEST-001 v1.0*
