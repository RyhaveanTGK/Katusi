// services/i18n.js — 5 dilli tərcümə sistemi (default: EN)
// Dillər: en (default), az, tr, ru, ka (Gürcü)
// Hər dilin öz valyutası və məzənnəsi var. Baza valyuta = AZN (bazada saxlanılan balans).

const LOCALES = [
  { code: 'en', label: 'English',    native: 'English',    flag: '🇺🇸', currency: 'USD', symbol: '$',  rate: 0.59, intl: 'en-US', dailyBonus: 0.50 },
  { code: 'az', label: 'Azerbaijani',native: 'Azərbaycan', flag: '🇦🇿', currency: 'AZN', symbol: '₼',  rate: 1,    intl: 'az-AZ', dailyBonus: 0.50 },
  { code: 'tr', label: 'Turkish',    native: 'Türkçe',     flag: '🇹🇷', currency: 'TRY', symbol: '₺',  rate: 24,   intl: 'tr-TR', dailyBonus: 15 },
  { code: 'ru', label: 'Russian',    native: 'Русский',    flag: '🇷🇺', currency: 'RUB', symbol: '₽',  rate: 47,   intl: 'ru-RU', dailyBonus: 30 },
  { code: 'ka', label: 'Georgian',   native: 'ქართული',    flag: '🇬🇪', currency: 'GEL', symbol: '₾',  rate: 1.6,  intl: 'ka-GE', dailyBonus: 1.5 }
];

const DEFAULT_LOCALE = 'en';

function normalizeLocale(v) {
  const l = String(v || '').toLowerCase().slice(0, 2);
  return LOCALES.some((x) => x.code === l) ? l : DEFAULT_LOCALE;
}

function localeMeta(code) {
  return LOCALES.find((l) => l.code === normalizeLocale(code)) || LOCALES[0];
}

/** Bazada AZN saxlanılan məbləği aktiv dilin valyutasına çevirir */
function convert(amountAzn, code) {
  const m = localeMeta(code);
  return Number(amountAzn || 0) * m.rate;
}

/** "125.40 ₺" formatı */
function money(amountAzn, code, opts = {}) {
  const m = localeMeta(code);
  const v = opts.raw ? Number(amountAzn || 0) : convert(amountAzn, code);
  const s = v.toLocaleString(m.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.symbol === false ? s : `${s} ${m.symbol}`;
}

// ─────────────────────────── Tərcümələr ───────────────────────────
const DICT = {
  en: {
    'app.name': 'One Loto',
    'nav.home': 'Home', 'nav.winners': 'Winners', 'nav.referral': 'Invite', 'nav.profile': 'Profile',
    'nav.wallet': 'Wallet', 'nav.settings': 'Settings', 'nav.logout': 'Log out', 'nav.language': 'Language',

    'auth.login': 'Log in', 'auth.register': 'Sign up',
    'auth.login.title': 'Welcome back', 'auth.login.sub': 'Log in to your account and keep playing',
    'auth.register.title': 'Create an account', 'auth.register.sub': 'Sign up in a minute and start playing',
    'auth.username': 'Username', 'auth.email': 'E-mail', 'auth.password': 'Password',
    'auth.password2': 'Confirm password', 'auth.phone': 'Phone number',
    'auth.fullname': 'Full name', 'auth.birthdate': 'Date of birth',
    'auth.forgot': 'Forgot password?', 'auth.no_account': "Don't have an account?",
    'auth.have_account': 'Already have an account?', 'auth.submit_login': 'Log in',
    'auth.submit_register': 'Create account',

    'winners.title': 'Winners', 'winners.sub': 'The leaderboard ranks players by stars collected across all rooms.',
    'winners.time_left': 'Time until payout', 'winners.payout_now': 'Paying out prizes…',
    'winners.place': 'place', 'winners.tab_top': 'Star leaderboard', 'winners.tab_recent': 'Recent winners',
    'winners.my_rank': 'Your rank', 'winners.period_stars': 'stars this cycle',
    'winners.play_to_rank': 'play to enter the list', 'winners.tickets': 'tickets',
    'winners.total': 'total', 'winners.prize': 'prize', 'winners.empty': 'No stars collected in this cycle yet',
    'winners.empty_recent': 'No games finished yet',
    'winners.note': 'Prizes are transferred to balances automatically every 24 hours and counters reset.',
    'winners.last_payout': 'Last payout',

    'wallet.title': 'Wallet', 'wallet.sub': 'Deposit and withdrawal operations',
    'wallet.balance': 'Current balance', 'wallet.deposits': 'Deposits', 'wallet.withdraws': 'Withdrawals',
    'wallet.tab_deposit': 'Deposit', 'wallet.tab_withdraw': 'Withdraw',
    'wallet.choose_method': 'Choose a payment method',
    'wallet.no_methods': 'No payment method has been added for this country yet.',
    'wallet.details_hint': 'Payment details will appear here once you pick a method.',
    'wallet.card_number': 'Card number', 'wallet.iban': 'IBAN', 'wallet.holder': 'Account holder',
    'wallet.wallet_address': 'Wallet address', 'wallet.network': 'Network',
    'wallet.copy': 'Copy', 'wallet.copied': 'Copied!',
    'wallet.amount': 'Amount', 'wallet.your_card': 'Card / account you paid from',
    'wallet.name_surname': 'Name Surname', 'wallet.receipt': 'Payment receipt (photo or PDF)',
    'wallet.receipt_hint': 'Transfer to the card above, then upload the receipt. Admin and the Telegram bot confirm it.',
    'wallet.submit_deposit': 'Send deposit request', 'wallet.submit_withdraw': 'Send withdrawal request',
    'wallet.history': 'Transaction history', 'wallet.empty_history': 'No transactions yet',
    'wallet.pending': 'Pending', 'wallet.completed': 'Approved', 'wallet.rejected': 'Rejected',
    'wallet.deposit_ok': 'Your request has been received. It will be credited after verification.',

    'settings.title': 'Settings', 'settings.account': 'Account details',
    'settings.language': 'Language', 'settings.language_hint': 'Interface language, currency and deposit methods change together.',
    'settings.save': 'Save', 'settings.saved': 'Details updated', 'settings.language_saved': 'Language updated',
    'settings.change_password': 'Change password',
    'common.error': 'Something went wrong', 'common.back': 'Back',     'join.title': 'Buy tickets',
    'join.full_ticket': 'FULL TICKET',
    'join.starting': 'Starting',
    'join.waiting': 'Waiting for players',
    'join.entry_fee': 'Entry fee',
    'join.players': 'Players',
    'join.prize': 'Prize pool',
    'join.ticket_count': 'How many tickets?',
    'join.your_tickets': 'Your tickets',
    'join.ticket': 'Ticket',
    'join.total': 'Total',
    'join.buy': 'Buy ticket',
    'room.create': 'Create room',
    'room.empty': 'No active rooms right now',
    'room.online': 'players online',
    'room.jackpot': 'JACKPOT',
    'room.waiting': 'Waiting for players',
    'room.started': 'Started',
    'room.starting': 'Starting',
    'room.return': 'Back to game',
    'room.private': 'Private',
    'room.win': 'win',
    'room.last_winners': 'Last winners',
    'bonus.title': 'Daily bonus',
    'bonus.desc': 'Claim your free bonus once every 24 hours.',
    'bonus.claim': 'Claim bonus',
    'bonus.claimed': 'Bonus credited to your balance',
    'bonus.next': 'Next bonus in',
    'bonus.ready': 'Ready to claim',
    'referral.bonus_each': 'bonus for every sign-up',
    'referral.earned': 'Earned',
    'referral.invited': 'Invited friends',
    'referral.step_bonus': 'You get a bonus',
    'referral.step_bonus_text': 'is added to your balance automatically',
    'common.cancel': 'Cancel'
  },

  az: {
    'app.name': 'One Loto',
    'nav.home': 'Ana səhifə', 'nav.winners': 'Qaliblər', 'nav.referral': 'Dəvət', 'nav.profile': 'Profil',
    'nav.wallet': 'Balans', 'nav.settings': 'Ayarlar', 'nav.logout': 'Çıxış', 'nav.language': 'Dil',

    'auth.login': 'Giriş', 'auth.register': 'Qeydiyyat',
    'auth.login.title': 'Xoş gəldiniz', 'auth.login.sub': 'Hesabınıza daxil olun və oyuna davam edin',
    'auth.register.title': 'Hesab yaradın', 'auth.register.sub': 'Bir dəqiqəyə qeydiyyatdan keçin və oynamağa başlayın',
    'auth.username': 'İstifadəçi adı', 'auth.email': 'E-poçt', 'auth.password': 'Şifrə',
    'auth.password2': 'Şifrəni təsdiqlə', 'auth.phone': 'Telefon nömrəsi',
    'auth.fullname': 'Ad Soyad', 'auth.birthdate': 'Doğum tarixi',
    'auth.forgot': 'Şifrəni unutmusunuz?', 'auth.no_account': 'Hesabınız yoxdur?',
    'auth.have_account': 'Artıq hesabınız var?', 'auth.submit_login': 'Daxil ol',
    'auth.submit_register': 'Hesab yarat',

    'winners.title': 'Qaliblər', 'winners.sub': 'Liderboard bütün otaqlarda ən çox ulduz yığan oyunçulara görədir.',
    'winners.time_left': 'Uduşlara qalan vaxt', 'winners.payout_now': 'Uduşlar paylanır…',
    'winners.place': 'yer', 'winners.tab_top': 'Ulduz liderboardu', 'winners.tab_recent': 'Son qaliblər',
    'winners.my_rank': 'Sizin yeriniz', 'winners.period_stars': 'bu dövrdə ulduz',
    'winners.play_to_rank': 'siyahıya düşmək üçün oyna', 'winners.tickets': 'bilet',
    'winners.total': 'ümumi', 'winners.prize': 'uduş', 'winners.empty': 'Bu dövrdə hələ ulduz yığan yoxdur',
    'winners.empty_recent': 'Hələ heç bir oyun bitməyib',
    'winners.note': 'Hər 24 saatdan bir uduşlar avtomatik balansa köçürülür və sayğaclar sıfırlanır.',
    'winners.last_payout': 'Son ödəniş',

    'wallet.title': 'Balans', 'wallet.sub': 'Depozit və çıxarış əməliyyatları',
    'wallet.balance': 'Cari balans', 'wallet.deposits': 'Depozit', 'wallet.withdraws': 'Çıxarış',
    'wallet.tab_deposit': 'Balans artır', 'wallet.tab_withdraw': 'Çıxarış',
    'wallet.choose_method': 'Ödəniş üsulunu seçin',
    'wallet.no_methods': 'Bu ölkə üçün ödəniş üsulu hələ əlavə edilməyib.',
    'wallet.details_hint': 'Üsul seçdikdə ödəniş rekvizitləri burada görünəcək.',
    'wallet.card_number': 'Kart nömrəsi', 'wallet.iban': 'IBAN', 'wallet.holder': 'Hesab sahibi',
    'wallet.wallet_address': 'Cüzdan ünvanı', 'wallet.network': 'Şəbəkə',
    'wallet.copy': 'Kopyala', 'wallet.copied': 'Kopyalandı!',
    'wallet.amount': 'Məbləğ', 'wallet.your_card': 'Ödəniş etdiyiniz kart / hesab',
    'wallet.name_surname': 'Ad Soyad', 'wallet.receipt': 'Ödəniş qəbzi (şəkil və ya PDF)',
    'wallet.receipt_hint': 'Yuxarıdakı karta köçürün, sonra qəbzi yükləyin. Təsdiq admin panel və Telegram bot vasitəsilə aparılır.',
    'wallet.submit_deposit': 'Depozit sorğusu göndər', 'wallet.submit_withdraw': 'Çıxarış sorğusu göndər',
    'wallet.history': 'Əməliyyat tarixçəsi', 'wallet.empty_history': 'Hələ əməliyyat yoxdur',
    'wallet.pending': 'Gözləyir', 'wallet.completed': 'Təsdiqləndi', 'wallet.rejected': 'Rədd edildi',
    'wallet.deposit_ok': 'Sorğunuz qəbul edildi. Yoxlamadan sonra balansınıza yüklənəcək.',

    'settings.title': 'Ayarlar', 'settings.account': 'Hesab məlumatları',
    'settings.language': 'Dil', 'settings.language_hint': 'İnterfeys dili, valyuta və deposit üsulları birlikdə dəyişir.',
    'settings.save': 'Yadda saxla', 'settings.saved': 'Məlumatlar yeniləndi', 'settings.language_saved': 'Dil yeniləndi',
    'settings.change_password': 'Şifrəni dəyiş',
    'common.error': 'Xəta baş verdi', 'common.back': 'Geri',     'join.title': 'Bilet al',
    'join.full_ticket': 'TAM BİLET',
    'join.starting': 'Başlayır',
    'join.waiting': 'Oyunçu gözlənilir',
    'join.entry_fee': 'Giriş haqqı',
    'join.players': 'Oyunçular',
    'join.prize': 'Bank',
    'join.ticket_count': 'Neçə bilet?',
    'join.your_tickets': 'Biletləriniz',
    'join.ticket': 'Bilet',
    'join.total': 'Ümumi',
    'join.buy': 'Bilet al',
    'room.create': 'Otaq yarat',
    'room.empty': 'Hazırda aktiv otaq yoxdur',
    'room.online': 'onlayn oyunçular',
    'room.jackpot': 'JACKPOT',
    'room.waiting': 'Oyunçu gözlənilir',
    'room.started': 'Başladı',
    'room.starting': 'Başlayır',
    'room.return': 'Oyuna qayıt',
    'room.private': 'Şəxsi',
    'room.win': 'qazan',
    'room.last_winners': 'Son qaliblər',
    'bonus.title': 'Gündəlik bonus',
    'bonus.desc': 'Hər 24 saatdan bir pulsuz bonusunuzu alın.',
    'bonus.claim': 'Bonusu al',
    'bonus.claimed': 'Bonus balansınıza əlavə olundu',
    'bonus.next': 'Növbəti bonusa qalıb',
    'bonus.ready': 'Hazırdır',
    'referral.bonus_each': 'hər qeydiyyatdan bonus',
    'referral.earned': 'Qazanılıb',
    'referral.invited': 'Dəvət olunanlar',
    'referral.step_bonus': 'Bonus alırsınız',
    'referral.step_bonus_text': 'balansınıza avtomatik əlavə edilir',
    'common.cancel': 'Ləğv et'
  },

  tr: {
    'app.name': 'One Loto',
    'nav.home': 'Ana sayfa', 'nav.winners': 'Kazananlar', 'nav.referral': 'Davet', 'nav.profile': 'Profil',
    'nav.wallet': 'Cüzdan', 'nav.settings': 'Ayarlar', 'nav.logout': 'Çıkış', 'nav.language': 'Dil',

    'auth.login': 'Giriş', 'auth.register': 'Kayıt ol',
    'auth.login.title': 'Tekrar hoş geldiniz', 'auth.login.sub': 'Hesabına giriş yap ve oynamaya devam et',
    'auth.register.title': 'Hesap oluştur', 'auth.register.sub': 'Bir dakikada kayıt ol ve oynamaya başla',
    'auth.username': 'Kullanıcı adı', 'auth.email': 'E-posta', 'auth.password': 'Şifre',
    'auth.password2': 'Şifreyi onayla', 'auth.phone': 'Telefon numarası',
    'auth.fullname': 'Ad Soyad', 'auth.birthdate': 'Doğum tarihi',
    'auth.forgot': 'Şifreni mi unuttun?', 'auth.no_account': 'Hesabın yok mu?',
    'auth.have_account': 'Zaten hesabın var mı?', 'auth.submit_login': 'Giriş yap',
    'auth.submit_register': 'Hesap oluştur',

    'winners.title': 'Kazananlar', 'winners.sub': 'Sıralama tüm odalarda en çok yıldız toplayan oyunculara göredir.',
    'winners.time_left': 'Ödüllere kalan süre', 'winners.payout_now': 'Ödüller dağıtılıyor…',
    'winners.place': 'sıra', 'winners.tab_top': 'Yıldız sıralaması', 'winners.tab_recent': 'Son kazananlar',
    'winners.my_rank': 'Senin sıran', 'winners.period_stars': 'bu turda yıldız',
    'winners.play_to_rank': 'listeye girmek için oyna', 'winners.tickets': 'bilet',
    'winners.total': 'toplam', 'winners.prize': 'ödül', 'winners.empty': 'Bu turda henüz yıldız toplayan yok',
    'winners.empty_recent': 'Henüz biten oyun yok',
    'winners.note': 'Ödüller her 24 saatte bir otomatik bakiyeye aktarılır ve sayaçlar sıfırlanır.',
    'winners.last_payout': 'Son ödeme',

    'wallet.title': 'Cüzdan', 'wallet.sub': 'Yatırma ve çekme işlemleri',
    'wallet.balance': 'Mevcut bakiye', 'wallet.deposits': 'Yatırma', 'wallet.withdraws': 'Çekme',
    'wallet.tab_deposit': 'Para yatır', 'wallet.tab_withdraw': 'Para çek',
    'wallet.choose_method': 'Ödeme yöntemini seç',
    'wallet.no_methods': 'Bu ülke için henüz ödeme yöntemi eklenmedi.',
    'wallet.details_hint': 'Yöntem seçtiğinde ödeme bilgileri burada görünecek.',
    'wallet.card_number': 'Kart numarası', 'wallet.iban': 'IBAN', 'wallet.holder': 'Hesap sahibi',
    'wallet.wallet_address': 'Cüzdan adresi', 'wallet.network': 'Ağ',
    'wallet.copy': 'Kopyala', 'wallet.copied': 'Kopyalandı!',
    'wallet.amount': 'Tutar', 'wallet.your_card': 'Ödeme yaptığın kart / hesap',
    'wallet.name_surname': 'Ad Soyad', 'wallet.receipt': 'Ödeme dekontu (fotoğraf veya PDF)',
    'wallet.receipt_hint': 'Yukarıdaki karta transfer et, sonra dekontu yükle. Onay admin panel ve Telegram bot ile yapılır.',
    'wallet.submit_deposit': 'Yatırma talebi gönder', 'wallet.submit_withdraw': 'Çekim talebi gönder',
    'wallet.history': 'İşlem geçmişi', 'wallet.empty_history': 'Henüz işlem yok',
    'wallet.pending': 'Bekliyor', 'wallet.completed': 'Onaylandı', 'wallet.rejected': 'Reddedildi',
    'wallet.deposit_ok': 'Talebin alındı. Kontrol sonrası bakiyene yüklenecek.',

    'settings.title': 'Ayarlar', 'settings.account': 'Hesap bilgileri',
    'settings.language': 'Dil', 'settings.language_hint': 'Arayüz dili, para birimi ve yatırma yöntemleri birlikte değişir.',
    'settings.save': 'Kaydet', 'settings.saved': 'Bilgiler güncellendi', 'settings.language_saved': 'Dil güncellendi',
    'settings.change_password': 'Şifre değiştir',
    'common.error': 'Bir hata oluştu', 'common.back': 'Geri',     'join.title': 'Bilet al',
    'join.full_ticket': 'TAM BİLET',
    'join.starting': 'Başlıyor',
    'join.waiting': 'Oyuncu bekleniyor',
    'join.entry_fee': 'Giriş ücreti',
    'join.players': 'Oyuncular',
    'join.prize': 'Ödül havuzu',
    'join.ticket_count': 'Kaç bilet?',
    'join.your_tickets': 'Biletleriniz',
    'join.ticket': 'Bilet',
    'join.total': 'Toplam',
    'join.buy': 'Bilet al',
    'room.create': 'Oda oluştur',
    'room.empty': 'Şu anda aktif oda yok',
    'room.online': 'çevrimiçi oyuncu',
    'room.jackpot': 'JACKPOT',
    'room.waiting': 'Oyuncu bekleniyor',
    'room.started': 'Başladı',
    'room.starting': 'Başlıyor',
    'room.return': 'Oyuna dön',
    'room.private': 'Özel',
    'room.win': 'kazan',
    'room.last_winners': 'Son kazananlar',
    'bonus.title': 'Günlük bonus',
    'bonus.desc': '24 saatte bir ücretsiz bonusunu al.',
    'bonus.claim': 'Bonusu al',
    'bonus.claimed': 'Bonus bakiyenize eklendi',
    'bonus.next': 'Sonraki bonusa kalan',
    'bonus.ready': 'Hazır',
    'referral.bonus_each': 'her kayıt için bonus',
    'referral.earned': 'Kazanılan',
    'referral.invited': 'Davet edilenler',
    'referral.step_bonus': 'Bonus kazanırsınız',
    'referral.step_bonus_text': 'otomatik olarak bakiyenize eklenir',
    'common.cancel': 'İptal'
  },

  ru: {
    'app.name': 'One Loto',
    'nav.home': 'Главная', 'nav.winners': 'Победители', 'nav.referral': 'Пригласить', 'nav.profile': 'Профиль',
    'nav.wallet': 'Кошелёк', 'nav.settings': 'Настройки', 'nav.logout': 'Выйти', 'nav.language': 'Язык',

    'auth.login': 'Вход', 'auth.register': 'Регистрация',
    'auth.login.title': 'С возвращением', 'auth.login.sub': 'Войдите в аккаунт и продолжайте играть',
    'auth.register.title': 'Создать аккаунт', 'auth.register.sub': 'Зарегистрируйтесь за минуту и начните играть',
    'auth.username': 'Имя пользователя', 'auth.email': 'E-mail', 'auth.password': 'Пароль',
    'auth.password2': 'Подтвердите пароль', 'auth.phone': 'Номер телефона',
    'auth.fullname': 'Имя и фамилия', 'auth.birthdate': 'Дата рождения',
    'auth.forgot': 'Забыли пароль?', 'auth.no_account': 'Нет аккаунта?',
    'auth.have_account': 'Уже есть аккаунт?', 'auth.submit_login': 'Войти',
    'auth.submit_register': 'Создать аккаунт',

    'winners.title': 'Победители', 'winners.sub': 'Рейтинг составлен по количеству звёзд во всех комнатах.',
    'winners.time_left': 'До выплаты призов', 'winners.payout_now': 'Призы распределяются…',
    'winners.place': 'место', 'winners.tab_top': 'Рейтинг звёзд', 'winners.tab_recent': 'Последние победители',
    'winners.my_rank': 'Ваше место', 'winners.period_stars': 'звёзд за цикл',
    'winners.play_to_rank': 'играйте, чтобы попасть в список', 'winners.tickets': 'билетов',
    'winners.total': 'всего', 'winners.prize': 'приз', 'winners.empty': 'В этом цикле пока нет звёзд',
    'winners.empty_recent': 'Пока не завершена ни одна игра',
    'winners.note': 'Каждые 24 часа призы автоматически зачисляются на баланс, счётчики обнуляются.',
    'winners.last_payout': 'Последняя выплата',

    'wallet.title': 'Кошелёк', 'wallet.sub': 'Пополнение и вывод средств',
    'wallet.balance': 'Текущий баланс', 'wallet.deposits': 'Пополнения', 'wallet.withdraws': 'Выводы',
    'wallet.tab_deposit': 'Пополнить', 'wallet.tab_withdraw': 'Вывести',
    'wallet.choose_method': 'Выберите способ оплаты',
    'wallet.no_methods': 'Для этой страны способы оплаты ещё не добавлены.',
    'wallet.details_hint': 'После выбора способа здесь появятся реквизиты.',
    'wallet.card_number': 'Номер карты', 'wallet.iban': 'IBAN', 'wallet.holder': 'Владелец счёта',
    'wallet.wallet_address': 'Адрес кошелька', 'wallet.network': 'Сеть',
    'wallet.copy': 'Копировать', 'wallet.copied': 'Скопировано!',
    'wallet.amount': 'Сумма', 'wallet.your_card': 'Карта / счёт, с которого оплатили',
    'wallet.name_surname': 'Имя Фамилия', 'wallet.receipt': 'Квитанция (фото или PDF)',
    'wallet.receipt_hint': 'Переведите на карту выше, затем загрузите квитанцию. Подтверждение — в админ-панели и Telegram-боте.',
    'wallet.submit_deposit': 'Отправить заявку на пополнение', 'wallet.submit_withdraw': 'Отправить заявку на вывод',
    'wallet.history': 'История операций', 'wallet.empty_history': 'Операций пока нет',
    'wallet.pending': 'Ожидает', 'wallet.completed': 'Подтверждено', 'wallet.rejected': 'Отклонено',
    'wallet.deposit_ok': 'Заявка принята. После проверки сумма будет зачислена на баланс.',

    'settings.title': 'Настройки', 'settings.account': 'Данные аккаунта',
    'settings.language': 'Язык', 'settings.language_hint': 'Язык интерфейса, валюта и способы пополнения меняются вместе.',
    'settings.save': 'Сохранить', 'settings.saved': 'Данные обновлены', 'settings.language_saved': 'Язык обновлён',
    'settings.change_password': 'Сменить пароль',
    'common.error': 'Произошла ошибка', 'common.back': 'Назад',     'join.title': 'Купить билеты',
    'join.full_ticket': 'ПОЛНЫЙ БИЛЕТ',
    'join.starting': 'Начинается',
    'join.waiting': 'Ожидание игроков',
    'join.entry_fee': 'Вход',
    'join.players': 'Игроки',
    'join.prize': 'Призовой фонд',
    'join.ticket_count': 'Сколько билетов?',
    'join.your_tickets': 'Ваши билеты',
    'join.ticket': 'Билет',
    'join.total': 'Итого',
    'join.buy': 'Купить билет',
    'room.create': 'Создать комнату',
    'room.empty': 'Сейчас нет активных комнат',
    'room.online': 'игроков онлайн',
    'room.jackpot': 'ДЖЕКПОТ',
    'room.waiting': 'Ожидание игроков',
    'room.started': 'Началась',
    'room.starting': 'Начинается',
    'room.return': 'Вернуться в игру',
    'room.private': 'Приватная',
    'room.win': 'выигрыш',
    'room.last_winners': 'Последние победители',
    'bonus.title': 'Ежедневный бонус',
    'bonus.desc': 'Забирайте бесплатный бонус раз в 24 часа.',
    'bonus.claim': 'Забрать бонус',
    'bonus.claimed': 'Бонус зачислен на баланс',
    'bonus.next': 'Следующий бонус через',
    'bonus.ready': 'Доступен',
    'referral.bonus_each': 'бонус за каждую регистрацию',
    'referral.earned': 'Заработано',
    'referral.invited': 'Приглашено',
    'referral.step_bonus': 'Вы получаете бонус',
    'referral.step_bonus_text': 'автоматически зачисляется на ваш баланс',
    'common.cancel': 'Отмена'
  },

  ka: {
    'app.name': 'One Loto',
    'nav.home': 'მთავარი', 'nav.winners': 'გამარჯვებულები', 'nav.referral': 'მოწვევა', 'nav.profile': 'პროფილი',
    'nav.wallet': 'საფულე', 'nav.settings': 'პარამეტრები', 'nav.logout': 'გასვლა', 'nav.language': 'ენა',

    'auth.login': 'შესვლა', 'auth.register': 'რეგისტრაცია',
    'auth.login.title': 'კეთილი იყოს თქვენი დაბრუნება', 'auth.login.sub': 'შედით ანგარიშზე და განაგრძეთ თამაში',
    'auth.register.title': 'ანგარიშის შექმნა', 'auth.register.sub': 'დარეგისტრირდით ერთ წუთში და დაიწყეთ თამაში',
    'auth.username': 'მომხმარებლის სახელი', 'auth.email': 'ელ. ფოსტა', 'auth.password': 'პაროლი',
    'auth.password2': 'გაიმეორეთ პაროლი', 'auth.phone': 'ტელეფონის ნომერი',
    'auth.fullname': 'სახელი და გვარი', 'auth.birthdate': 'დაბადების თარიღი',
    'auth.forgot': 'დაგავიწყდათ პაროლი?', 'auth.no_account': 'არ გაქვთ ანგარიში?',
    'auth.have_account': 'უკვე გაქვთ ანგარიში?', 'auth.submit_login': 'შესვლა',
    'auth.submit_register': 'ანგარიშის შექმნა',

    'winners.title': 'გამარჯვებულები', 'winners.sub': 'რეიტინგი ეფუძნება ყველა ოთახში დაგროვილ ვარსკვლავებს.',
    'winners.time_left': 'პრიზებამდე დარჩა', 'winners.payout_now': 'პრიზები ნაწილდება…',
    'winners.place': 'ადგილი', 'winners.tab_top': 'ვარსკვლავების რეიტინგი', 'winners.tab_recent': 'ბოლო გამარჯვებულები',
    'winners.my_rank': 'თქვენი ადგილი', 'winners.period_stars': 'ვარსკვლავი ამ ციკლში',
    'winners.play_to_rank': 'ითამაშეთ სიაში მოსახვედრად', 'winners.tickets': 'ბილეთი',
    'winners.total': 'სულ', 'winners.prize': 'პრიზი', 'winners.empty': 'ამ ციკლში ჯერ ვარსკვლავები არ დაგროვდა',
    'winners.empty_recent': 'ჯერ არცერთი თამაში არ დასრულებულა',
    'winners.note': 'პრიზები ყოველ 24 საათში ავტომატურად ირიცხება ბალანსზე და მრიცხველები ნულდება.',
    'winners.last_payout': 'ბოლო გადახდა',

    'wallet.title': 'საფულე', 'wallet.sub': 'შევსება და გატანა',
    'wallet.balance': 'მიმდინარე ბალანსი', 'wallet.deposits': 'შევსება', 'wallet.withdraws': 'გატანა',
    'wallet.tab_deposit': 'ბალანსის შევსება', 'wallet.tab_withdraw': 'თანხის გატანა',
    'wallet.choose_method': 'აირჩიეთ გადახდის მეთოდი',
    'wallet.no_methods': 'ამ ქვეყნისთვის გადახდის მეთოდი ჯერ არ დამატებულა.',
    'wallet.details_hint': 'მეთოდის არჩევის შემდეგ აქ გამოჩნდება რეკვიზიტები.',
    'wallet.card_number': 'ბარათის ნომერი', 'wallet.iban': 'IBAN', 'wallet.holder': 'ანგარიშის მფლობელი',
    'wallet.wallet_address': 'საფულის მისამართი', 'wallet.network': 'ქსელი',
    'wallet.copy': 'კოპირება', 'wallet.copied': 'დაკოპირდა!',
    'wallet.amount': 'თანხა', 'wallet.your_card': 'ბარათი / ანგარიში, საიდანაც გადაიხადეთ',
    'wallet.name_surname': 'სახელი გვარი', 'wallet.receipt': 'ქვითარი (ფოტო ან PDF)',
    'wallet.receipt_hint': 'გადარიცხეთ ზემოთ მოცემულ ბარათზე და ატვირთეთ ქვითარი. დადასტურება ხდება ადმინ პანელში და Telegram ბოტში.',
    'wallet.submit_deposit': 'შევსების მოთხოვნის გაგზავნა', 'wallet.submit_withdraw': 'გატანის მოთხოვნის გაგზავნა',
    'wallet.history': 'ოპერაციების ისტორია', 'wallet.empty_history': 'ოპერაციები ჯერ არ არის',
    'wallet.pending': 'მოლოდინში', 'wallet.completed': 'დადასტურდა', 'wallet.rejected': 'უარყოფილია',
    'wallet.deposit_ok': 'მოთხოვნა მიღებულია. შემოწმების შემდეგ თანხა ჩაირიცხება ბალანსზე.',

    'settings.title': 'პარამეტრები', 'settings.account': 'ანგარიშის მონაცემები',
    'settings.language': 'ენა', 'settings.language_hint': 'ინტერფეისის ენა, ვალუტა და შევსების მეთოდები ერთად იცვლება.',
    'settings.save': 'შენახვა', 'settings.saved': 'მონაცემები განახლდა', 'settings.language_saved': 'ენა განახლდა',
    'settings.change_password': 'პაროლის შეცვლა',
    'common.error': 'დაფიქსირდა შეცდომა', 'common.back': 'უკან',     'join.title': 'ბილეთის ყიდვა',
    'join.full_ticket': 'სრული ბილეთი',
    'join.starting': 'იწყება',
    'join.waiting': 'ველოდებით მოთამაშეებს',
    'join.entry_fee': 'შესვლის საფასური',
    'join.players': 'მოთამაშეები',
    'join.prize': 'საპრიზო ფონდი',
    'join.ticket_count': 'რამდენი ბილეთი?',
    'join.your_tickets': 'თქვენი ბილეთები',
    'join.ticket': 'ბილეთი',
    'join.total': 'ჯამი',
    'join.buy': 'ბილეთის ყიდვა',
    'room.create': 'ოთახის შექმნა',
    'room.empty': 'აქტიური ოთახი ამჟამად არ არის',
    'room.online': 'მოთამაშე ონლაინ',
    'room.jackpot': 'ჯეკპოტი',
    'room.waiting': 'ველოდებით მოთამაშეებს',
    'room.started': 'დაიწყო',
    'room.starting': 'იწყება',
    'room.return': 'თამაშში დაბრუნება',
    'room.private': 'პირადი',
    'room.win': 'მოიგე',
    'room.last_winners': 'ბოლო გამარჯვებულები',
    'bonus.title': 'დღიური ბონუსი',
    'bonus.desc': 'მიიღეთ უფასო ბონუსი 24 საათში ერთხელ.',
    'bonus.claim': 'ბონუსის აღება',
    'bonus.claimed': 'ბონუსი დაემატა ბალანსს',
    'bonus.next': 'შემდეგი ბონუსი',
    'bonus.ready': 'ხელმისაწვდომია',
    'referral.bonus_each': 'ბონუსი ყოველ რეგისტრაციაზე',
    'referral.earned': 'გამომუშავებული',
    'referral.invited': 'მოწვეული მეგობრები',
    'referral.step_bonus': 'იღებთ ბონუსს',
    'referral.step_bonus_text': 'ავტომატურად ემატება თქვენს ბალანსს',
    'common.cancel': 'გაუქმება'
  }
};

/** t('wallet.title', 'tr') → "Cüzdan" (tapılmasa EN, sonra açar özü) */
function translate(key, code) {
  const l = normalizeLocale(code);
  return (DICT[l] && DICT[l][key]) || DICT[DEFAULT_LOCALE][key] || key;
}

// ── Post-render tərcümə: şablonlarda qalan AZ mətnləri hədəf dilə çevirir ──
const PHRASES = require('./phrases');
const PHRASE_KEYS = Object.keys(PHRASES).sort((a, b) => b.length - a.length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PHRASE_RE = PHRASE_KEYS.length
  ? new RegExp(PHRASE_KEYS.map(escapeRe).join('|'), 'g')
  : null;

function translateHtml(html, locale) {
  if (!PHRASE_RE || locale === 'az' || typeof html !== 'string') return html;
  return html.replace(PHRASE_RE, (m) => {
    const row = PHRASES[m];
    return (row && row[locale]) || (row && row.en) || m;
  });
}

/** Express middleware — res.locals.t / locale / locales / money */
function middleware(req, res, next) {
  const fromQuery = req.query && req.query.lang;
  if (fromQuery) req.session.locale = normalizeLocale(fromQuery);
  const locale = normalizeLocale(req.session && (req.session.locale || req.session.userLocale));
  if (req.session) req.session.locale = locale;

  req.locale = locale;
  res.locals.locale = locale;
  res.locals.localeMeta = localeMeta(locale);
  res.locals.locales = LOCALES;
  res.locals.t = (key) => translate(key, locale);
  res.locals.money = (amountAzn, opts) => money(amountAzn, locale, opts);
  res.locals.currency = localeMeta(locale).symbol;

  // res.render nəticəsini tərcümə süzgəcindən keçir
  const origRender = res.render.bind(res);
  res.render = function (view, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return origRender(view, opts || {}, (err, html) => {
      if (err) return cb ? cb(err) : req.next(err);
      const out = translateHtml(html, locale);
      if (cb) return cb(null, out);
      res.send(out);
    });
  };
  next();
}

/** Seçilmiş dilə uyğun gündəlik bonus (yerli valyutada) → AZN bazasına çevirir */
function dailyBonusAzn(code) {
  const m = localeMeta(code);
  return Number(((Number(m.dailyBonus || 0.5)) / (m.rate || 1)).toFixed(4));
}

module.exports = {
  LOCALES, DEFAULT_LOCALE, normalizeLocale, localeMeta,
  convert, money, translate, t: translate, translateHtml, middleware, dailyBonusAzn
};

