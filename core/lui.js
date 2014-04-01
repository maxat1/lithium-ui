window.Lui = {
    version: '0.1.0',

    /**
     * Read a static view implementation and return an array of component configs.
     * @param {HTMLElement} target HTMLElement that contains the view. Typically this is document.body.
     * @param {Object} parentCfg Config of parent component. So that this method can be used recursively to establish parent-child relationship.
     */
    makeConfigFromViewImplementation: function (target) {
        var comps = [];
        Li.slice(target.childNodes).forEach(function (el) {
            if (el.nodeType === 1 && (/^(X|L)\-/).test(el.nodeName)) {
                var className = el.nodeName.replace(/^X\-/, '')
                        .replace(/^L\-/, 'Lui.')
                        .replace(/-/g, '.'),
                    classRef = this.getClass(className),
                    cfg;
                if (classRef.prototype.makeConfigFromViewImplementation) {
                    cfg = classRef.prototype.makeConfigFromViewImplementation(el, cfg);
                } else {
                    cfg = {
                        type: classRef.prototype.type
                    };
                }
                comps.push(cfg);
            }
        }, this);
        return comps;
    },

    /**
     * Pass an array of component configs, to return an array of initialized components.
     */
    create: function (ui) {
        var created = [];
        ui.forEach(function (o) {
            if (!(o instanceof Lui.Component)) {
                o.type = o.type || 'Lui.Box';
                var ClassRef = this.getClass(o.type), cmp;
                cmp = new ClassRef(o);
                o = cmp;
                created.push(o);
            }
        }, this);
        return created;
    },

    /**
     * Render an array of components to a render target element.
     */
    render: function (target, ui) {
        if (!target) {
            if (console) {
                console.error('Called Lui.render with undefined/null as target');
            }
            return null;
        }
        ui.forEach(function (o) {
            if (o instanceof Lui.Component) {
                o.render(target);
            }
        });
    },

    /**
     * Get a Class reference from global namespace.
     */
    getClass: function (type) {
        //TODO: Cache class references to improve performance.
        var classRef = this.getPart(type);
        if (!classRef) {
            throw new Error('Class does not exist');
        }
        return classRef;
    },

    /**
     * Gets any global namespace/Class reference from a given string.
     * @private
     */
    getPart: function (ns) {
        var obj = window;
        ns.split('.').some(function (part) {
            if (!obj[part]) {
                Object.keys(obj).some(function (n) {
                    if (n.toLowerCase() === part.toLowerCase()) {
                        obj = obj[n];
                        return true;
                    }
                });
            } else {
                obj = obj[part];
            }
            return !obj;
        });
        return obj;
    },

    /**
     * Uses Li.extend to create a new global Class of 'type' using a base Class and prototype.
     * This automatically adds type string to class (which Lui.Component uses to add data-type and class name to the rendered rool element).
     * @param {String} type Full namespace to be used for the new class. eg 'Lui.Box'.
     * @param {Function} baseClass
     * @param {Object} proto Protype to use on new class.
     */
    extend: function (type, baseClass, proto) {
        proto.type = type;
        var parts = type.split('.'),
            className = parts.pop(),
            ns = this.getPart(parts.join('.'));
        ns[className] = Li.extend(baseClass, proto);
    },

    /**
     * Recirsively traverses through a given component's instance
     * (or a plain object with type properties) and child items.
     */
    traverse: function (component, callback, context) {
        var classRef = this.getClass(component.type);
        if (classRef === Lui.Box || (classRef.prototype instanceof Lui.Box)) {
            (component.items || []).forEach(function (item) {
                callback.call(context, item);
                Lui.traverse(item, callback, context);
            });
        }
    }
};