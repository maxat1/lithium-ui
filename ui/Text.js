define(['../core/Component', 'tpl!./Text.ko'], function (Lui) {
    /**
     * Text field.
     */
    Lui.Text = Lui.extend('Lui.Text', Lui.Component, {
        cls: 'form-control',
        autocomplete: [],
        placeholder: '',
        getValue: function () {
            if (this.rootEl) {
                return this.rootEl.value;
            }
        },
        setValue: function (value) {
            if (this.rootEl) {
                this.rootEl.value = value;
            }
        },
        clear: function () {
            if (this.rootEl) {
                this.rootEl.value = '';
            }
        },
        /**
         * @override
         */
        makeConfigFromView: function (target) {
            var cfg = this.super(arguments),
                placeholder = target.getAttribute('placeholder'),
                value = target.textContent;
            if (placeholder) {
                cfg.placeholder = placeholder;
            }
            if (value) {
                cfg.value = value;
            }
            return cfg;
        },
        /**
         * @override
         */
        postRender: function () {
            this.adjustAutoComplete();
            this.super(arguments);
        },
        /**
         * @private
         */
        adjustAutoComplete: function () {
            if (this.autocomplete.length) {
                $(this.rootEl).autocomplete({
                    source: this.autocomplete
                });
            }
        }
    });

    return Lui;
});
