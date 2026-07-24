# Birloto.com – Online Tombala Platforması

## Texnologiyalar
- **Backend**: Node.js + Express.js
- **Verilənlər bazası**: MongoDB (Mongoose)
- **Şablon mühərriki**: EJS
- **Sessiya**: express-session + connect-mongo
- **Şifrələmə**: bcryptjs

## Quraşdırma

### 1. Asılılıqları yükləyin
```bash
npm install
```

### 2. Mühit dəyişənlərini konfiqurasiya edin
`.env.example` faylını `.env` kimi kopyalayın:
```bash
cp .env.example .env
```

`.env` faylını redaktə edin:
```
MONGODB_URI=mongodb+srv://r77513973_db_user:ZnVE8V5URKL2VG9i@venomkzn.utujwym.mongodb.net/?appName=Venomkzn
SESSION_SECRET=birloto_super_secret_key_2026
PORT=3000
NODE_ENV=production
```

### 3. Serveri başlatın
```bash
# İstehsal mühiti
npm start

# İnkişaf mühiti (nodemon ilə)
npm run dev
```

## Render.com-da Deploy

### Avtomatik (render.yaml ilə)
1. GitHub-a push edin
2. Render.com-da "New Web Service" seçin
3. Repository-ni bağlayın
4. `render.yaml` avtomatik tanınacaq

### Manual
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Mühit dəyişənləri**:
  - `MONGODB_URI` = MongoDB connection string
  - `SESSION_SECRET` = təsadüfi uzun sətir
  - `NODE_ENV` = production
  - `PORT` = 3000

## Saytın Strukturu

### Səhifələr
| Route | Açıqlama |
|-------|----------|
| `/` | Ana səhifə (oyun otaqları) |
| `/login` | Giriş səhifəsi |
| `/register` | Qeydiyyat səhifəsi |
| `/profile` | Profil səhifəsi |
| `/wallet` | Balans/Cüzdan |
| `/profile/referral` | Referral proqramı |
| `/winners` | Qaliblər lövhəsi |
| `/profile/setting` | Parametrlər |
| `/profile/changepass` | Şifrə dəyiştirmə |
| `/profile/games-played` | Oyun tarixçəsi |
| `/join/:roomId` | Oyuna qoşulma |
| `/gamestart/:roomId` | Aktiv oyun |
| `/admin/rooms` | Admin – Otaq idarəetməsi |
| `/admin/transactions` | Admin – Ödəniş idarəetməsi |

### API Endpoints
| Endpoint | Açıqlama |
|----------|----------|
| `GET /api/rooms-status` | Bütün otaqların vəziyyəti |
| `GET /api/room/:id` | Bir otağın detalları |
| `POST /api/admin/rooms/:id/start` | Oyunu başlat |
| `POST /api/admin/rooms/:id/draw` | Nömrə çək |
| `POST /api/admin/rooms/:id/end` | Oyunu bitir |

### MongoDB Koleksiyaları
- **users** – İstifadəçilər
- **rooms** – Oyun otaqları
- **gamecards** – Oyunçuların tombala kartları
- **transactions** – Maliyyə əməliyyatları

## Admin İstifadəçi Yaratmaq
MongoDB-də birbaşa:
```javascript
db.users.updateOne(
  { username: "admin_username" },
  { $set: { isAdmin: true } }
)
```

## Qeydlər
- Sayt 18+ yash məhdudiyyəti olan tombala platformasıdır
- Bütün pul əməliyyatları admin tərəfindən manual təsdiqlənir
- Jackpot sistemi hər oyunçunun qoşulması ilə artır
