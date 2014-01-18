INCLUDE('lui.js');
INCLUDE('utils/Observable.js');

/**
 * Base class for all components.
 */
Lui.extend('Lui.Component', Lui.Observable, {
    /**
     * Top most element of this component
     * @readonly
     */
    rootEl: null,
    /**
     * Inner html string
     */
    html: '',
    /**
     * CSS class to use on {@link #rootEl}.
     */
    cls: '',
    /**
     * Inline CSS style to apply on {@link #rootEl}.
     */
    style: '',
    constructor: function (cfg) {
        this.id = 'cmp-' + Lui.Component.getNewId();
        this.set(cfg);
    },
    /**
     * Set configuration. Call this.refresh to re-render this component with the new config.
     */
    set: function (cfg) {
        this.cfg = this.cfg || {};
        $.extend(this, cfg);
    },
    /**
     * This method gets the template (that is within script tag wth data-type=<type of component>)
     * parses it as HTML and stores it as this.tpl.dom and the original tpl as string as this.tpl.text.
     */
    prepareTemplate: function () {
        if (!this.tpl) {
            var tpl = $('script[data-type="' + this.type + '"]')[0];
            if (tpl) {
                var text = tpl.firstChild.nodeValue.trim();
                this.tpl = {
                    dom: Li.dom(text),
                    text: text
                };
            }
        }
    },
    /**
     * Parse Logical View.
     * @param {HTMLElement} el Component's root element in logical view.
     */
    parseLV: function (element) {
        this.prepareTemplate();
        var cfg = {
            type: this.type,
            id: element.id || undefined,
            cls: element.className || undefined,
            style: element.getAttribute('style') || undefined,
            ref: element.getAttribute('ref') || undefined,
            html: element.innerHTML
        };
        return cfg;
    },
    /**
     * @returns {String} The html string to be used by {@link #render} method.
     * @protected
     */
    getCssClass: function () {
        var typeCls = this.type.toLowerCase().replace(/\./g, '-'),
            cls = Object.getPrototypeOf(this).cls,
            extraCls = this.hasOwnProperty('cls') ? this.cls : '';
        return  (typeCls + ' ' + cls + (cls ? ' ': '') + extraCls).trim();
    },
    /**
     * @protected
     */
    getHtmlStart: function () {
        var html = Li.format('<div id="{0}" data-type="{1}"', this.id, this.type),
            cls = this.getCssClass();
        html += cls ? Li.format(' class="{0}"', cls) : '';
        html += this.style ? Li.format(' style="{0}"', this.style) : '';
        html += Li.format('>');
        return html;
    },
    /**
     * Can be overridden by a derived class.
     * @protected
     */
    getHtmlSelf: function () {
        //FIXME: Something is not right here.
        this.prepareTemplate();
        return this.html;
    },
    /**
     * @protected
     */
    getHtmlEnd: function () {
        return '</div>';
    },
    /**
     * @returns {String} The html string to be used by {@link #render} method.
     * @protected
     */
    getHtml: function () {
        return this.getHtmlStart() + this.getHtmlSelf() + this.getHtmlEnd();
    },

    /**
     * @protected
     */
    renderOuter: function (target, childIndex) {
        var df = Li.dom(this.getHtml());
        target.insertBefore(df, target.childNodes[childIndex]);
        this.rootEl = $('#' + this.id, target)[0];
    },
    /**
     * Abstract method. To be used by derived classes like Box.
     * @protected
     */
    renderInner: $.noop,
    /**
     * Render component to target HTMLElement. Uses this.getHtml to render component.
     * @protected
     */
    render: function (target, childIndex) {
        this.renderOuter(target, childIndex);
        this.renderInner(target, childIndex);
        this.postRender(target);
        this.trigger('afterrender', this);
    },
    /**
     * Remove this component from document.
     * @protected
     */
    unrender: function () {
        if (this.rootEl && this.rootEl.parentNode) {
            this.rootEl.parentNode.removeChild(this.rootEl);
        }
        this.rootEl = null;
    },
    /**
     * Post render processing. Mainly attaching of listeners.
     * @protected
     */
    postRender: function (target) {
        this.removeListeners(target);
        this.initListeners(target);
    },
    initListeners: function () {
        if (this.listeners) {
            if (this.listeners.dom) {
                var list = this.listeners.dom;
                Li.forEach(list, function (fn, event) {
                    if (!fn._binded_) {
                        fn = list[event] = Li.bind(fn, this.listeners.scope || this);
                        fn._binded_ = true;
                    }
                    $(this.rootEl).on(event, fn);
                }, this);
            }
            Li.forEach(this.listeners, function (fn, event) {
                if (event !== 'dom' && event !== 'scope') {
                    this.on(event, fn, this.listeners.scope || this);
                }
            }, this);
        }
    },
    removeListeners: function () {
        if (this.listeners) {
            if (this.listeners.dom) {
                Li.forEach(this.listeners.dom, function (fn, event) {
                    $(this.rootEl).off(event, fn);
                }, this);
            }
            Li.forEach(this.listeners, function (fn, event) {
                if (event !== 'dom' && event !== 'scope') {
                    this.off(event, fn);
                }
            }, this);
        }
    },
    statics: {
        id: 1,
        getNewId: function () {
            return Lui.Component.id++;
        }
    }
});
