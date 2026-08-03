/**
 * Internationalisation (i18n) de Toumai — 6 langues, avec support de l'arabe
 * (droite à gauche). La langue choisie est mémorisée (localStorage) ; changer
 * de langue recharge la page pour tout ré-afficher proprement.
 *
 * Usage :
 *   - HTML statique : <span data-i18n="clef"></span> (texte),
 *                     <input data-i18n-ph="clef"> (placeholder).
 *   - JS dynamique  : window.i18n.t('clef'[, { s: 60 }]).
 */
(function () {
  const TR = {
    fr: {
      subtitle: 'Automatisation e-commerce', login_tab: 'Connexion', register_tab: 'Créer un compte',
      email_label: 'Email', password_label: 'Mot de passe', signin_btn: 'Se connecter',
      register_btn: 'Créer le compte', forgot: 'Mot de passe oublié ?',
      hint: 'Première utilisation ? Le premier compte créé devient administrateur.',
      install: '⤓ Installer', logout: 'Déconnexion', run_cycle: '⚙️ Lancer un cycle complet',
      start_pilot: 'Démarrer le pilote', stop_pilot: 'Arrêter le pilote',
      pilot_off: '○ Pilote arrêté', pilot_active: '● Pilote actif (cycle {s}s)',
      nav_dashboard: 'Tableau de bord', nav_market: 'Marché', nav_products: 'Produits',
      nav_suppliers: 'Fournisseurs', nav_orders: 'Commandes', nav_channels: 'Canaux de vente',
      nav_discovery: 'Recherche', nav_competitors: 'Compétiteurs', nav_ads: 'Publicités',
      nav_reports: 'Tableur', nav_wallet: 'Portefeuille', nav_settings: 'Paramètres', language: 'Langue',
    },
    en: {
      subtitle: 'E-commerce automation', login_tab: 'Sign in', register_tab: 'Create account',
      email_label: 'Email', password_label: 'Password', signin_btn: 'Sign in',
      register_btn: 'Create account', forgot: 'Forgot password?',
      hint: 'First time? The first account created becomes the administrator.',
      install: '⤓ Install', logout: 'Log out', run_cycle: '⚙️ Run a full cycle',
      start_pilot: 'Start autopilot', stop_pilot: 'Stop autopilot',
      pilot_off: '○ Autopilot stopped', pilot_active: '● Autopilot active (every {s}s)',
      nav_dashboard: 'Dashboard', nav_market: 'Market', nav_products: 'Products',
      nav_suppliers: 'Suppliers', nav_orders: 'Orders', nav_channels: 'Sales channels',
      nav_discovery: 'Search', nav_competitors: 'Competitors', nav_ads: 'Ads',
      nav_reports: 'Spreadsheet', nav_wallet: 'Wallet', nav_settings: 'Settings', language: 'Language',
    },
    ar: {
      subtitle: 'أتمتة التجارة الإلكترونية', login_tab: 'تسجيل الدخول', register_tab: 'إنشاء حساب',
      email_label: 'البريد الإلكتروني', password_label: 'كلمة المرور', signin_btn: 'تسجيل الدخول',
      register_btn: 'إنشاء الحساب', forgot: 'هل نسيت كلمة المرور؟',
      hint: 'أول مرة؟ أول حساب يتم إنشاؤه يصبح المسؤول.',
      install: '⤓ تثبيت', logout: 'تسجيل الخروج', run_cycle: '⚙️ تشغيل دورة كاملة',
      start_pilot: 'تشغيل الطيار الآلي', stop_pilot: 'إيقاف الطيار الآلي',
      pilot_off: '○ الطيار الآلي متوقف', pilot_active: '● الطيار الآلي نشط (كل {s} ثانية)',
      nav_dashboard: 'لوحة التحكم', nav_market: 'السوق', nav_products: 'المنتجات',
      nav_suppliers: 'الموردون', nav_orders: 'الطلبات', nav_channels: 'قنوات البيع',
      nav_discovery: 'البحث', nav_competitors: 'المنافسون', nav_ads: 'الإعلانات',
      nav_reports: 'جدول البيانات', nav_wallet: 'المحفظة', nav_settings: 'الإعدادات', language: 'اللغة',
    },
    tr: {
      subtitle: 'E-ticaret otomasyonu', login_tab: 'Giriş', register_tab: 'Hesap oluştur',
      email_label: 'E-posta', password_label: 'Şifre', signin_btn: 'Giriş yap',
      register_btn: 'Hesap oluştur', forgot: 'Şifrenizi mi unuttunuz?',
      hint: 'İlk kez mi? Oluşturulan ilk hesap yönetici olur.',
      install: '⤓ Yükle', logout: 'Çıkış yap', run_cycle: '⚙️ Tam döngü çalıştır',
      start_pilot: 'Otomatik pilotu başlat', stop_pilot: 'Otomatik pilotu durdur',
      pilot_off: '○ Otomatik pilot durduruldu', pilot_active: '● Otomatik pilot aktif ({s}sn)',
      nav_dashboard: 'Gösterge paneli', nav_market: 'Pazar', nav_products: 'Ürünler',
      nav_suppliers: 'Tedarikçiler', nav_orders: 'Siparişler', nav_channels: 'Satış kanalları',
      nav_discovery: 'Arama', nav_competitors: 'Rakipler', nav_ads: 'Reklamlar',
      nav_reports: 'Elektronik tablo', nav_wallet: 'Cüzdan', nav_settings: 'Ayarlar', language: 'Dil',
    },
    es: {
      subtitle: 'Automatización de comercio electrónico', login_tab: 'Iniciar sesión', register_tab: 'Crear cuenta',
      email_label: 'Correo electrónico', password_label: 'Contraseña', signin_btn: 'Iniciar sesión',
      register_btn: 'Crear la cuenta', forgot: '¿Olvidó su contraseña?',
      hint: '¿Primera vez? La primera cuenta creada se convierte en administrador.',
      install: '⤓ Instalar', logout: 'Cerrar sesión', run_cycle: '⚙️ Ejecutar un ciclo completo',
      start_pilot: 'Iniciar el piloto', stop_pilot: 'Detener el piloto',
      pilot_off: '○ Piloto detenido', pilot_active: '● Piloto activo (cada {s}s)',
      nav_dashboard: 'Panel', nav_market: 'Mercado', nav_products: 'Productos',
      nav_suppliers: 'Proveedores', nav_orders: 'Pedidos', nav_channels: 'Canales de venta',
      nav_discovery: 'Búsqueda', nav_competitors: 'Competidores', nav_ads: 'Anuncios',
      nav_reports: 'Hoja de cálculo', nav_wallet: 'Billetera', nav_settings: 'Ajustes', language: 'Idioma',
    },
    zh: {
      subtitle: '电子商务自动化', login_tab: '登录', register_tab: '创建账户',
      email_label: '电子邮箱', password_label: '密码', signin_btn: '登录',
      register_btn: '创建账户', forgot: '忘记密码？',
      hint: '首次使用？创建的第一个账户将成为管理员。',
      install: '⤓ 安装', logout: '退出登录', run_cycle: '⚙️ 运行完整周期',
      start_pilot: '启动自动驾驶', stop_pilot: '停止自动驾驶',
      pilot_off: '○ 自动驾驶已停止', pilot_active: '● 自动驾驶运行中（每{s}秒）',
      nav_dashboard: '仪表板', nav_market: '市场', nav_products: '产品',
      nav_suppliers: '供应商', nav_orders: '订单', nav_channels: '销售渠道',
      nav_discovery: '搜索', nav_competitors: '竞争对手', nav_ads: '广告',
      nav_reports: '电子表格', nav_wallet: '钱包', nav_settings: '设置', language: '语言',
    },
  };

  const RTL = ['ar'];
  let lang = localStorage.getItem('toumai_lang') || 'fr';
  if (!TR[lang]) lang = 'fr';

  function t(key, vars) {
    let s = (TR[lang] && TR[lang][key] != null) ? TR[lang][key] : (TR.fr[key] != null ? TR.fr[key] : key);
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n'));
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-ph'));
      if (v != null) el.setAttribute('placeholder', v);
    });
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
    document.querySelectorAll('.lang-select').forEach((s) => { s.value = lang; });
  }

  function setLang(l) {
    if (!TR[l] || l === lang) return;
    localStorage.setItem('toumai_lang', l);
    location.reload();
  }

  window.i18n = { t, apply, setLang, getLang: () => lang, langs: Object.keys(TR) };

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.lang-select').forEach((s) => s.addEventListener('change', () => setLang(s.value)));
  });
})();
