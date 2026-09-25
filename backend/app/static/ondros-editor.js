/**
 * Ondros Universal Editor bridge.
 *
 * A connected project includes this script; it is what lets the editor treat
 * the project's own deployed site as an editing surface, the way Adobe's
 * Universal Editor does. Served by the CMS so every site runs the same
 * version:
 *
 *   <script src="https://cms.example.com/code-sync/ondros-editor.js" defer></script>
 *
 * The script does nothing unless the page is inside the Ondros editor (it
 * checks for an `ondros-preview` query parameter or being framed), so it is
 * safe to ship on production pages.
 *
 * Instrumentation the site provides, mirroring data-aue-*:
 *
 *   data-ondros-resource="entry:<uuid>"  the entry a subtree renders
 *   data-ondros-prop="<fieldId>"         the field an element renders
 *   data-ondros-type="text|longtext|richtext|select|number|media|reference"
 *   data-ondros-label="Hero heading"     optional, shown in the overlay
 *   data-ondros-component="<id>"         marks a whole component block
 *
 * The legacy data-cms-entry-id / data-cms-field-id / data-cms-field-type
 * attributes are understood too, so the bundled preview app and any site
 * already instrumented for it keep working.
 */
(function () {
  'use strict';

  var MSG = {
    FIELD_SELECTED: 'cms:field-selected',
    INLINE_EDIT: 'cms:inline-edit',
    PREVIEW_READY: 'cms:preview-ready',
    FIELD_UPDATED: 'cms:field-updated',
    SET_INSPECTOR: 'cms:set-inspector',
  };

  var params = new URLSearchParams(window.location.search);
  var framed = window.parent !== window;
  if (!framed && !params.has('ondros-preview')) return;

  var locale = params.get('ondros-locale') || params.get('locale') || '';
  // Set when the editor is previewing a block: that component gets scrolled
  // to and outlined, because the page around it is only context.
  var focusEntryId = params.get('ondros-focus') || '';
  var inspectorEnabled = true;
  var editing = false;

  var EDITABLE_TYPES = ['text', 'longtext', 'richtext', 'slug', 'select', 'number'];

  // ---- element lookup -------------------------------------------------------

  var FIELD_SELECTOR = '[data-ondros-prop],[data-cms-field-id]';
  var RESOURCE_SELECTOR = '[data-ondros-resource],[data-cms-entry-id]';

  function fieldIdOf(el) {
    return el.getAttribute('data-ondros-prop') || el.getAttribute('data-cms-field-id') || '';
  }

  function fieldTypeOf(el) {
    return el.getAttribute('data-ondros-type') || el.getAttribute('data-cms-field-type') || 'text';
  }

  function labelOf(el) {
    return el.getAttribute('data-ondros-label') || fieldIdOf(el);
  }

  /** "entry:<uuid>" and a bare uuid both resolve to the uuid. */
  function resourceIdOf(el) {
    var raw = el.getAttribute('data-ondros-resource') || el.getAttribute('data-cms-entry-id') || '';
    var match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw);
    return match ? match[1] : raw;
  }

  function fieldOf(target) {
    return target && target.closest ? target.closest(FIELD_SELECTOR) : null;
  }

  function entryOf(el) {
    var host = el.closest(RESOURCE_SELECTOR);
    return host ? resourceIdOf(host) : '';
  }

  function post(payload) {
    if (framed) window.parent.postMessage(payload, '*');
  }

  // ---- overlay chrome --------------------------------------------------------

  var style = document.createElement('style');
  style.textContent =
    '.ondros-hover{outline:2px solid #4c8dff !important;outline-offset:2px;cursor:text}' +
    '.ondros-focus{outline:2px dashed #8b5cf6 !important;outline-offset:4px}' +
    '.ondros-editing{outline:2px solid #22c55e !important;outline-offset:2px}' +
    '.ondros-tag{position:absolute;z-index:2147483647;background:#111827;color:#fff;' +
    'font:500 11px/1.6 ui-sans-serif,system-ui,sans-serif;padding:1px 6px;border-radius:4px;' +
    'pointer-events:none;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)}';
  document.head.appendChild(style);

  var tag = document.createElement('div');
  tag.className = 'ondros-tag';
  tag.style.display = 'none';
  document.body.appendChild(tag);

  function showTag(el, text) {
    var rect = el.getBoundingClientRect();
    tag.textContent = text;
    tag.style.display = 'block';
    tag.style.top = Math.max(2, rect.top + window.scrollY - 22) + 'px';
    tag.style.left = rect.left + window.scrollX + 'px';
  }

  // ---- inspector -------------------------------------------------------------

  document.addEventListener('mouseover', function (e) {
    if (!inspectorEnabled || editing) return;
    var el = fieldOf(e.target);
    if (!el) return;
    el.classList.add('ondros-hover');
    showTag(el, labelOf(el));
  });

  document.addEventListener('mouseout', function (e) {
    var el = fieldOf(e.target);
    if (el) el.classList.remove('ondros-hover');
    tag.style.display = 'none';
  });

  document.addEventListener('click', function (e) {
    if (!inspectorEnabled) return;
    var el = fieldOf(e.target);
    if (!el || el.isContentEditable) return;
    // Don't let the site navigate away while it is being inspected.
    e.preventDefault();
    post({ type: MSG.FIELD_SELECTED, entryId: entryOf(el), fieldId: fieldIdOf(el) });
  });

  // ---- inline editing ---------------------------------------------------------

  document.addEventListener('dblclick', function (e) {
    var el = fieldOf(e.target);
    if (!el || el.isContentEditable) return;
    var type = fieldTypeOf(el);
    // Structured values (references, media, json) are edited in the form —
    // there is no sensible contenteditable representation of them.
    if (EDITABLE_TYPES.indexOf(type) === -1) return;

    e.preventDefault();
    editing = true;
    tag.style.display = 'none';
    el.classList.remove('ondros-hover');
    el.classList.add('ondros-editing');
    el.contentEditable = 'true';
    el.focus();

    function commit() {
      el.contentEditable = 'false';
      el.classList.remove('ondros-editing');
      el.removeEventListener('blur', commit);
      el.removeEventListener('keydown', onKey);
      editing = false;
      post({
        type: MSG.INLINE_EDIT,
        entryId: entryOf(el),
        fieldId: fieldIdOf(el),
        value: type === 'richtext' ? el.innerHTML : el.textContent || '',
        locale: locale,
      });
    }

    function onKey(ke) {
      if (ke.key === 'Escape') el.blur();
      if (ke.key === 'Enter' && type !== 'richtext') {
        ke.preventDefault();
        el.blur();
      }
    }

    el.addEventListener('blur', commit);
    el.addEventListener('keydown', onKey);
  });

  // ---- messages from the editor ------------------------------------------------

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === MSG.SET_INSPECTOR) {
      inspectorEnabled = !!data.enabled;
      if (!inspectorEnabled) tag.style.display = 'none';
      return;
    }

    if (data.type === MSG.FIELD_UPDATED) {
      // Patch the DOM directly so typing in the form shows up here without a
      // reload. Scoped to the entry the update belongs to, so a page holding
      // three cards doesn't rewrite all three.
      var scope = document;
      var hosts = document.querySelectorAll(RESOURCE_SELECTOR);
      for (var i = 0; i < hosts.length; i++) {
        if (resourceIdOf(hosts[i]) === data.entryId) {
          scope = hosts[i];
          break;
        }
      }
      var nodes = scope.querySelectorAll(FIELD_SELECTOR);
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (fieldIdOf(node) !== data.fieldId || node.isContentEditable) continue;
        var value = data.value;
        // Localized fields arrive as {locale: value} maps.
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          value = value[locale] !== undefined ? value[locale] : Object.values(value)[0];
        }
        if (typeof value === 'string' || typeof value === 'number') {
          if (fieldTypeOf(node) === 'richtext') node.innerHTML = String(value);
          else node.textContent = String(value);
        }
      }
    }
  });

  // ---- component focus -----------------------------------------------------------

  function revealFocus() {
    if (!focusEntryId) return;
    var hosts = document.querySelectorAll(RESOURCE_SELECTOR);
    for (var i = 0; i < hosts.length; i++) {
      if (resourceIdOf(hosts[i]) === focusEntryId) {
        hosts[i].classList.add('ondros-focus');
        hosts[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }

  // ---- announce ----------------------------------------------------------------

  function ready() {
    revealFocus();
    var instrumented = document.querySelectorAll(FIELD_SELECTOR).length;
    post({
      type: MSG.PREVIEW_READY,
      entryId: focusEntryId || (document.querySelector(RESOURCE_SELECTOR)
        ? resourceIdOf(document.querySelector(RESOURCE_SELECTOR))
        : ''),
      // Lets the editor warn when a page loads but carries no instrumentation
      // at all — the usual symptom of a site that hasn't added the attributes.
      instrumentedFields: instrumented,
      href: window.location.href,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
