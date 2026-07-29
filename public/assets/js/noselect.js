// Global kopyalama qadağası — yalnız login/şifrə/bonus/parol dəyişmə sahələrində icazə verilir.
(function(){
  var css = 'body,body *{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;-webkit-touch-callout:none;}' +
            'input,textarea,[contenteditable="true"]{-webkit-user-select:text!important;-moz-user-select:text!important;-ms-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important;}';
  var s = document.createElement('style'); s.appendChild(document.createTextNode(css));
  (document.head || document.documentElement).appendChild(s);

  function isAllowedField(el){
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    var type = (el.type || '').toLowerCase();
    var name = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
    if (type === 'password') return true;
    if (/user|login|email|phone|nomre|bonus|promo|code|kod|current-password|new-password|old-password|pass|parol|sifre|şifr/.test(name)) return true;
    if (/changepass|change-password|parol-deyis|password|login|register/.test((location.pathname || '').toLowerCase())) return true;
    return false;
  }
  function block(e){
    var t = e.target;
    if (isAllowedField(t)) return;
    if (t && t.closest && t.closest('input, textarea')) {
      if (isAllowedField(t.closest('input, textarea'))) return;
    }
    e.preventDefault(); e.stopPropagation(); return false;
  }
  ['copy','cut','contextmenu','dragstart','selectstart'].forEach(function(ev){
    document.addEventListener(ev, block, true);
  });
  document.addEventListener('keydown', function(e){
    var t = e.target;
    if (isAllowedField(t)) return;
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var k = (e.key || '').toLowerCase();
    if (['c','x','a','s','p','u'].indexOf(k) !== -1){
      e.preventDefault(); e.stopPropagation(); return false;
    }
  }, true);
})();
