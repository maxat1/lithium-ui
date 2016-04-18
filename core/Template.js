/*global console*/
/*jslint evil: true*/

(function (factory, saferEval) {
    define(['jquery',
        './util/js-object-literal-parse',
        './Observable',
        './base/lithium'
    ], function ($, parseObjectLiteral, Li) {
        Li.Template = factory.call(this, saferEval, $, parseObjectLiteral, Li);
        return Li;
    }.bind(this));
}(function (saferEval, $, parseObjectLiteral, Li) {
    //var window = document.defaultView;

    function unwrap(str) {
        var o = {};
        str.split(',').forEach(function (val) {
            o[val] = true;
        });
        return o;
    }

    //HTML 4 and 5 void tags
    var voidTags = unwrap('area,base,basefont,br,col,command,embed,frame,hr,img,input,keygen,link,meta,param,source,track,wbr'),
        conflictingBindings = unwrap('if,ifnot,foreach,with,text,html'),
        traverse = Li.traverse;

    /**
     * @param {String|DocumentFragment} template If string, then it is better if the HTML is balanced, else it probably won't be correctly converted to DOM.
     * @param {Object} cfg
     * @param {Object} cfg.noConflict Will ensure Htmlizer doesn't conflict with KnockoutJS. i.e data-htmlizer attribute will be used and
     * containerless statements beginning and ending with "ko" prefix will be ignored.
     */
    function Htmlizer(template, cfg) {
        this.cfg = cfg;
        //The depth at which this template is in within another template.
        //depth = number of ancestor nodes to parent template. 0 for root template.
        this.depth = 0;
        $.extend(this, cfg);
        if (typeof template === 'string') {
            this.origTplStr = template;
            this.frag = util.moveToNewFragment(util.parseHTML(template));
        } else { //assuming DocumentFragment
            this.frag = template;
        }
        this.nodeInfoList = []; //list of nodes along with it's binding, depth, sub template etc.
        this.nodeMap = {}; //used to quickly map a node to it's nodeInfo.
        this.prepare();
    }

    Htmlizer.prototype = {
        /**
         * Identifies sub-templates, comment statement blocks and populates nodeInfoList and nodeMap.
         * @private
         */
        prepare: function () {
            var frag = this.frag,
                blocks = this.getVirtualBlocks(),
                depth = this.depth,
                blockNodes, tempFrag;
            traverse(frag, frag, function (node, isOpenTag) {
                if (isOpenTag) {
                    depth += 1;
                    var nodeInfo = {},
                        bindings;
                    if (node.nodeType === 1) { //element
                        var classRef;
                        if (node.nodeName.indexOf('-') > -1) {
                            var className = node.nodeName.replace(/-/g, '.');
                            classRef = Li.getClass(className);
                        }

                        var bindOpts = node.getAttribute(this.noConflict ? 'data-htmlizer' : 'data-bind');
                        if (bindOpts) {
                            this.checkForConflictingBindings(bindOpts, classRef);
                            bindings = util.parseObjectLiteral(bindOpts);
                            nodeInfo.node = node;
                            nodeInfo.depth = depth;
                            nodeInfo.bindings = bindings;
                            if (bindings.foreach || bindings['with'] || bindings['if'] || bindings.ifnot) {
                                tempFrag = util.moveToNewFragment(Li.slice(node.childNodes));
                                nodeInfo.subTpl = new Htmlizer(tempFrag, $.extend({depth: depth}, this.cfg));
                            }
                            this.nodeInfoList.push(nodeInfo);
                            this.nodeMap[Li.getUID(node)] = nodeInfo;
                        }

                        if (classRef) { //do not add component inner config to nodeInfoList
                            return 'continue';
                        }
                    }

                    //HTML comment node
                    if (node.nodeType === 8) {
                        var stmt = node.data.trim(), match;

                        //Ignore all containerless statements beginning with "ko" if noConflict = true.
                        if (this.noConflict && (/^(ko |\/ko$)/).test(stmt)) {
                            return;
                        }

                        var block = util.findBlockFromStartNode(blocks, node);
                        if (block) {
                            nodeInfo.node = node;
                            nodeInfo.depth = depth;
                            nodeInfo.block = block;
                            match = stmt.match(util.regex.commentStatment);
                            nodeInfo.bindings = {};
                            nodeInfo.bindings[match[1]] = match[2];
                            if (block.key === 'foreach' || block.key === 'with' || block.key === 'if' || block.key === 'ifnot') {
                                blockNodes = util.getImmediateNodes(frag, block.start, block.end);
                                tempFrag = util.moveToNewFragment(blockNodes);
                                nodeInfo.subTpl = new Htmlizer(tempFrag, $.extend({depth: depth}, this.cfg));
                            }
                            this.nodeInfoList.push(nodeInfo);
                            this.nodeMap[Li.getUID(node)] = nodeInfo;
                        }
                    }
                } else {
                    depth -= 1;
                }
            }, this);
        },

        /**
         * Get binding and other information for a given node in template DocumentFragment.
         */
        getBindingInfo: function (node) {
            return this.nodeMap[Li.getUID(node)];
        },

        /**
         * @param {Object} data
         */
        toDocumentFragment: function (data, context) {
            return (new Htmlizer.View(this, data, context)).toDocumentFragment();
        },

        /**
         * @param {Object} data
         */
        toString: function (data, context) {
            return (new Htmlizer.View(this, data, context)).toString();
        },

        /**
         * Go through HTML comment statements and determine the start and end node of each statement.
         * @private
         */
        getVirtualBlocks: function () {
            if (this.blocks) { //return cached copy
                return this.blocks;
            }
            var stack = [], //Keep track of ifs and fors
                blocks = [],
                block;

            //Before evaluating, determine the nesting structure for containerless statements.
            traverse(this.frag, this.frag, function (node, isOpenTag) {
                //HTML comment node
                if (isOpenTag && node.nodeType === 8) {
                    var stmt = node.data.trim(), match;

                    //Ignore all containerless statements beginning with "ko" if noConflict = true.
                    if (this.noConflict && (/^(ko |\/ko$)/).test(stmt)) {
                        return;
                    }

                    if ((match = stmt.match(/^(?:ko|hz)[ ]+([^:]+):/))) {
                        stack.unshift({
                            key: match[1],
                            start: node
                        });
                    } else if ((match = stmt.match(/^\/(ko|hz)$/))) {
                        block = stack.shift();
                        if (block) {
                            block.end = node;
                            blocks.push(block);
                        } else {
                            console.warn('Extra end tag found.');
                        }
                    }
                }
            }, this);
            if (stack.length) {
                throw new Error('Missing end tag for ' + stack[0].start.data.trim());
            }
            this.blocks = blocks; //cache blocks.
            return blocks;
        },

        /**
         * @param {String} bindOpts Bindings as string
         * @private
         */
        checkForConflictingBindings: function (bindOpts, isComponent) {
            var conflict = [];
            util.forEachObjectLiteral(bindOpts, function (binding) {
                if (isComponent) {
                    if (binding !== 'attr') {
                        conflict.push(binding);
                    }
                } else if (binding in conflictingBindings) {
                    conflict.push(binding);
                }
            });

            if (isComponent && conflict.length) {
                throw new Error('Component only supports attr binding.');
            } else if (conflict.length > 1) {
                throw new Error('Multiple bindings (' + conflict[0] + ' and ' + conflict[1] + ') are trying to control descendant bindings of the same element.' +
                    'You cannot use these bindings together on the same element.');
            }
        }

    };

    /**
     * @param {Li.Template} template Li.Template instance
     * @param {Object} data Any data
     * @param {Object} context [Context] in which this view should run. Used internally.
     * @param {Li.Template.View} [parentView] parent of this view. Used internally.
     */
    Htmlizer.View = function (template, data, context, parentView) {
        this.tpl = template;
        this.data = data;
        this.context = context || {
            $parents: [],
            $root: data,
            $data: data,
            $rawData: data
        };
        this.parentView = parentView || null;

        //Track first and last child after render.
        this.fragment = null;
        this.firstChild = null;
        this.lastChild = null;

        this.nodeInfoList = []; //will contain the binding information for each node.
        this.nodeMap = {}; //used to quickly map a node to it's nodeInfo.

        this.components = [];
        this.componentMap = {};
        this.exprEvaluatorCache = {}; //cache function for each expression, so that it doesn't need to
        //be eval'ed all the time.

        this.retired = false;

        //Partially render the view, as Components and sub-components need to be constructed before render.
        this.toDocumentFragment();
    };

    Htmlizer.View.saferEval = saferEval;

    Htmlizer.View.prototype = {
        bindingHandler: {
            componenttag: {
                init: function (node, tNode, ClassRef) {
                    node.innerHTML = tNode.innerHTML;
                    if (ClassRef) {
                        var cfg = {}, cmp;
                        //Parse node to a config
                        if (ClassRef.prototype.makeConfigFromView) {
                            if (node.hasAttribute('params')) {
                                cfg = util.parseObjectLiteral(node.getAttribute('params'));
                                //Convert to right data type (like integers).
                                Li.forEach(cfg, function (expr, key) {
                                    cfg[key] = saferEval.call(this.getRootView(), expr, this.context, this.data, node);
                                }, this);
                            }
                            cfg = ClassRef.prototype.makeConfigFromView(node, cfg);
                        }
                        cfg.type = ClassRef.prototype.type;
                        cfg.parent = this.context.$root;

                        //Create instance from config
                        cmp = new ClassRef(cfg);
                        //Resolve reference using ref attribute
                        var ref = node.getAttribute('ref');
                        if (ref && cfg.parent) {
                            var rel = cfg.parent;
                            ref.split('.').slice(0, -1).forEach(function (part) {
                                rel = rel[part];
                            });
                            rel[ref.split('.').slice(-1)[0]] = cmp;
                        }

                        //Add to components list for rendering later
                        this.components.push({cmp: cmp, node: node});
                        this.componentMap[Li.getUID(node)] = cmp;

                        return {domTraverse: 'continue'}; //ignore inner content
                    }
                },
                update: function (node, attr) {
                    var cmp = this.componentMap[Li.getUID(node)];
                    if (cmp) {
                        var cfg = {};
                        if (attr === 'class') {
                            cfg.cls = node.getAttribute(attr);
                        } else {
                            cfg[attr] = node.getAttribute(attr);
                        }
                        cmp.set(cfg);
                    }
                }
            },
            component: {
                init: function (node, binding, expr, tNode, blocks) {
                    if (node.nodeType === 8) {
                        expr = expr.trim();
                        var val;
                        if (expr[0] === '{') {
                            var inner = util.parseObjectLiteral(expr);
                            val = {
                                ref: this.evaluate(binding, inner.ref, node),
                                params: util.parseObjectLiteral(inner.params || '')
                            };
                            if (val.params) {
                                //Convert to right data type (like integers).
                                Li.forEach(val.params, function (expr, key) {
                                    val.params[key] = saferEval.call(this.getRootView(), expr, this.context, this.data, node);
                                }, this);
                            }
                        } else {
                            val = {
                                ref: this.evaluate(binding, expr, node),
                                params: {}
                            };
                        }

                        var cmp = val.ref;
                        if (cmp instanceof Li.Component) {
                            cmp.set(Li.mix(val.params, {parent: this.context.$root}));

                            //Add to components list for rendering later
                            this.components.push({cmp: cmp, node: node});
                            this.componentMap[Li.getUID(node)] = cmp;
                        }

                        var block = util.findBlockFromStartNode(blocks, tNode);
                        return {ignoreTillNode: block.end};
                    }
                }
            },
            template: {
                init: function (node, binding, expr, tNode, blocks) {
                    if (node.nodeType === 8) {
                        var tpl = this.evaluate(binding, expr, node);
                        if (tpl) {
                            var view = this.makeView(tpl, this.context, this.data, node),
                                tempFrag = view.toDocumentFragment();
                            node.parentNode.insertBefore(tempFrag, node.nextSibling);
                        } else {
                            console.warn('Sub-template "' + expr.trim() + '" for component ' + this.context.$root.type + ' is undefined');
                        }
                        node.parentNode.removeChild(node);
                        var block = util.findBlockFromStartNode(blocks, tNode);
                        return {ignoreTillNode: block.end};
                    }
                }
            },
            "if": {
                init: function (node, binding, expr, tNode) {
                    var val = this.evaluate(binding, expr, node);
                    if (val) {
                        var tpl = this.tpl.getBindingInfo(tNode).subTpl,
                            view = this.makeView(tpl, this.context, this.data, node),
                            tempFrag = view.toDocumentFragment();
                        if (node.nodeType === 1) {
                            node.appendChild(tempFrag);
                        } else if (node.nodeType === 8) {
                            node.parentNode.insertBefore(tempFrag, node.nextSibling);
                        }
                    }
                },
                update: function (node, binding, expr) {
                    var val = this.evaluate(binding, expr, node),
                        info = this.getNodeInfo(node),
                        view = info.views[0];
                    if (!view) { //if view not created, the create it.
                        var tpl = this.tpl.getBindingInfo(info.tNode).subTpl;
                        view = this.makeView(tpl, this.context, this.data, node);
                    }
                    var tempFrag = view.toDocumentFragment(); //if rendered, move nodes from document to DocumentFragment

                    if (val) {
                        if (node.nodeType === 1) {
                            node.appendChild(tempFrag);
                        } else if (node.nodeType === 8) {
                            node.parentNode.insertBefore(tempFrag, node.nextSibling);
                        }
                    }
                }
            },
            ifnot: {
                init: function (node, binding, expr, tNode, blocks) {
                    //Convert ifnot: (...) to if: !(...)
                    binding = 'if';
                    expr = '!(' + expr + ')';
                    return this.bindingHandler[binding].init.call(this,
                        node, binding, expr, tNode, blocks);
                },
                update: function (node, binding, expr) {
                    //Convert ifnot: (...) to if: !(...)
                    binding = 'if';
                    expr = '!(' + expr + ')';
                    return this.bindingHandler[binding].update.call(this, node, binding, expr);
                }
            },
            foreach: {
                init: function (node, binding, expr) {
                    var info = this.getNodeInfo(node),
                        tNode = info.tNode,
                        tpl = this.tpl.getBindingInfo(tNode).subTpl,
                        val;

                    expr = expr.trim();
                    if (expr[0] === '{') {
                        var inner = util.parseObjectLiteral(expr);
                        val = {
                            items: this.evaluate(binding, inner.data, node),
                            as: inner.as.slice(1, -1) //strip string quote
                        };
                    } else {
                        val = {items: this.evaluate(binding, expr, node)};
                    }

                    if (tpl.frag.firstChild && val.items instanceof Array) {
                        this.spliceForEachItems(tpl, node, 0, info.views ? info.views.length : 0, val.items, val.as);
                    }
                },
                sort: function (node, binding, expr, indexes) {
                    var info = this.getNodeInfo(node);
                    if (info.views) {
                        var output = document.createDocumentFragment();

                        var views = [];
                        //Sort views
                        indexes.forEach(function (i) {
                            views.push(info.views[i]);
                        });
                        info.views = views;

                        info.views.forEach(function (view) {
                            output.appendChild(view.toDocumentFragment()); //removes from document and appends to 'output'
                        });
                        if (node.nodeType === 1) {
                            node.appendChild(output);
                        } else if (node.nodeType === 8) {
                            //Render inner template and insert berfore this node.
                            node.parentNode.insertBefore(output, info.blockEndNode);
                        }
                    }
                },
                splice: function (node, binding, expr, index, removeLength, newItems) {
                    var tNode = this.getNodeInfo(node).tNode,
                        bindingInfo = this.tpl.getBindingInfo(tNode),
                        tpl = this.tpl.getBindingInfo(tNode).subTpl,
                        as;

                    expr = bindingInfo.bindings.foreach.trim();
                    if (expr[0] === '{') {
                        as = util.parseObjectLiteral(expr).as.slice(1, -1);
                    }

                    if (tpl.frag.firstChild) {
                        this.spliceForEachItems(tpl, node, index, removeLength, newItems || [], as);
                    }
                },
                reverse: function (node) {
                    var info = this.getNodeInfo(node);
                    if (info.views) {
                        var output = document.createDocumentFragment();

                        info.views.reverse();
                        info.views.forEach(function (view) {
                            output.appendChild(view.toDocumentFragment()); //removes from document and appends to 'output'
                        });
                        if (node.nodeType === 1) {
                            node.appendChild(output);
                        } else if (node.nodeType === 8) {
                            //Render inner template and insert berfore this node.
                            node.parentNode.insertBefore(output, info.blockEndNode);
                        }
                    }
                }
            },
            "with": {
                init: function (node, binding, expr, tNode) {
                    var val = this.evaluate(binding, expr, node),
                        tpl = this.tpl.getBindingInfo(tNode).subTpl,
                        newContext = this.getNewContext(this.context, val);
                    if (tpl.frag.firstChild && val !== null && val !== undefined) {
                        var tempFrag = this.makeView(tpl, newContext, val, node).toDocumentFragment();
                        if (node.nodeType === 1) {
                            node.appendChild(tempFrag);
                        } else if (node.nodeType === 8) {
                            node.parentNode.insertBefore(tempFrag, node.nextSibling);
                        }
                    }
                }
            },
            text: {
                init: function (node, binding, expr, tNode, blocks) {
                    var val = this.evaluate(binding, expr, node);
                    if (val === null || val === undefined) {
                        val = '';
                    }
                    if (node.nodeType === 1) {
                        node.appendChild(document.createTextNode(val));
                        return {domTraverse: 'continue'}; //KO ignores the inner content.
                    } else if (node.nodeType === 8) {
                        var block = util.findBlockFromStartNode(blocks, tNode);
                        node.parentNode.insertBefore(document.createTextNode(val), node.nextSibling);
                        return {ignoreTillNode: block.end.previousSibling || block.end.parentNode};
                    }
                },
                update: function (node, binding, expr) {
                    var val = this.evaluate(binding, expr, node);
                    if (val === null || val === undefined) {
                        val = '';
                    }
                    if (node.nodeType === 1) {
                        $(node).empty();
                        node.appendChild(document.createTextNode(val));
                    } else if (node.nodeType === 8) {
                        var nodeInfo = this.getNodeInfo(node),
                            startNode = nodeInfo.node,
                            endNode = nodeInfo.blockEndNode;
                        util.moveToNewFragment(util.getImmediateNodes(node.ownerDocument, startNode, endNode)); // discard content
                        node.parentNode.insertBefore(document.createTextNode(val), node.nextSibling);
                    }
                }
            },
            html: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        $(node).empty();
                        var val = this.evaluate(binding, expr, node);
                        if (val !== undefined && val !== null && val !== '') {
                            var nodes = util.parseHTML(val + '');
                            if (nodes) {
                                var tempFrag = util.moveToNewFragment(nodes);
                                node.appendChild(tempFrag);
                            }
                        }
                    }
                },
                update: function () {
                    return this.bindingHandler.html.init.apply(this, arguments);
                }
            },
            attr: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        util.forEachObjectLiteral(expr.slice(1, -1), function (attr, value) {
                            var val = this.evaluate(binding + '.' + attr, value, node);
                            if (typeof val === 'string' || typeof val === 'number') {
                                node.setAttribute(attr, val + '');
                            }
                        }, this);
                    }
                },
                update: function (node, binding, expr, attr) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val || typeof val === 'string' || typeof val === 'number') {
                            node.setAttribute(attr, val + '');
                        } else { //undefined, null, false
                            node.removeAttribute(attr);
                        }
                        this.bindingHandler.componenttag.update.call(this, node, attr);
                    }
                }
            },
            css: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        util.forEachObjectLiteral(expr.slice(1, -1), function (className, expr) {
                            var val = this.evaluate(binding + '.' + className, expr, node);
                            if (val) {
                                $(node).addClass(className);
                            }
                        }, this);
                    }
                },
                update: function (node, binding, expr, className) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val) {
                            $(node).addClass(className);
                        } else {
                            $(node).removeClass(className);
                        }
                        this.bindingHandler.componenttag.update.call(this, node, 'class');
                    }
                }
            },
            style: (function () {
                function toCssProp(m) {
                    return '-' + m.toLowerCase();
                }
                return {
                    init: function (node, binding, expr) {
                        if (node.nodeType === 1) {
                            util.forEachObjectLiteral(expr.slice(1, -1), function (prop, expr) {
                                var val = this.evaluate(binding + '.' + prop, expr, node) || null;
                                node.style.setProperty(prop.replace(/[A-Z]/g, toCssProp), val);
                            }, this);
                        }
                    },
                    update: function (node, binding, expr, prop) {
                        if (node.nodeType === 1) {
                            var val = this.evaluate(binding, expr, node);
                            if (val || typeof val === 'string' || typeof val === 'number') {
                                node.style.setProperty(prop.replace(/[A-Z]/g, toCssProp), val + '');
                            } else { //undefined, null, false
                                node.style.removeProperty(prop.replace(/[A-Z]/g, toCssProp));
                            }
                            this.bindingHandler.componenttag.update.call(this, node, 'style');
                        }
                    }
                };
            }()),

            //Some of the following aren't treated as attributes by Knockout, but this is here to keep compatibility with Knockout.

            enable: {
                init: function (node, binding, expr) {
                    //binding could be 'disable' or 'enable'
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node),
                            disable = (binding === 'disable' ? val : !val);
                        if (disable) {
                            node.setAttribute('disabled', 'disabled');
                        } else {
                            node.removeAttribute('disabled');
                        }
                    }
                },
                update: function () {
                    return this.bindingHandler.enable.init.apply(this, arguments);
                }
            },
            disable: {
                init: function () {
                    return this.bindingHandler.enable.init.apply(this, arguments);
                },
                update: function () {
                    return this.bindingHandler.enable.update.apply(this, arguments);
                }
            },
            checked: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val) {
                            node.setAttribute('checked', 'checked');
                            node.checked = true;
                        } else {
                            node.removeAttribute('checked');
                            node.checked = false;
                        }
                    }
                },
                update: function () {
                    return this.bindingHandler.checked.init.apply(this, arguments);
                }
            },
            value: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val === null || val === undefined) {
                            node.removeAttribute('value');
                            node.value = '';
                        } else if (node.value !== (val + '')) {
                            node.setAttribute('value', val);
                            node.value = val;
                        }
                    }
                },
                update: function () {
                    return this.bindingHandler.value.init.apply(this, arguments);
                }
            },
            visible: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val) {
                            if (node.style.display === 'none') {
                                node.style.removeProperty('display');
                            }
                        } else {
                            node.style.setProperty('display', 'none');
                        }
                    }
                },
                update: function () {
                    return this.bindingHandler.visible.init.apply(this, arguments);
                }
            }
        },
        /**
         * Partial render. Renders everything except sub-components.
         * @private
         */
        toDocumentFragment: function () {
            this.retired = false;

            if (this.firstChild) { //if already rendered,
                var ownerDocument = this.firstChild.ownerDocument;
                //remove from document, add to new DocumentFragment, if it has changed
                if (!(ownerDocument === this.fragment && ownerDocument.firstChild === this.firstChild &&
                    ownerDocument.lastChild === this.lastChild)) {
                    var nodes = util.getImmediateNodes(this.firstChild.ownerDocument, this.firstChild, this.lastChild, true);
                    this.fragment = util.moveToFragment(nodes, this.fragment);
                }
                return this.fragment;
            }

            var frag = this.tpl.frag,
                output = document.createDocumentFragment();

            this.nodeInfoList = []; //clear previous node info. View instance can only bind to one document fragment.

            //Evaluate
            var blocks = this.tpl.getVirtualBlocks(),
                //two stacks - one to keep track of ancestors while inserting content
                //to output fragment, and the other to keep track of ancestors on template.
                stack = [output],
                tStack = [frag],
                commentStack = [],
                ignoreTillNode = null;
            traverse(frag, frag, function (tNode, isOpenTag) {
                if (!ignoreTillNode && isOpenTag) {
                    var node = tNode.cloneNode(false);
                    stack[stack.length - 1].appendChild(node);

                    var match, binding, control;
                    if (node.nodeType === 1) { //element
                        stack.push(node);
                        tStack.push(tNode);

                        var bindOpts = node.getAttribute(this.tpl.noConflict ? 'data-htmlizer' : 'data-bind');
                        if (bindOpts) {
                            node.removeAttribute(this.tpl.noConflict ? 'data-htmlizer' : 'data-bind');
                            this.addNodeInfo(node, tNode);
                        }

                        var ret;
                        util.forEachObjectLiteral(bindOpts, function (binding, value) {
                            if (this.bindingHandler[binding]) {
                                control = this.bindingHandler[binding].init.call(this,
                                    node, binding, value, tNode, blocks) || {};
                                if (control.domTraverse) {
                                    ret = control.domTraverse;
                                }
                                if (control.skipOtherbindings) {
                                    return true;
                                }
                                if (control.ignoreTillNode) {
                                    ignoreTillNode = control.ignoreTillNode;
                                }
                            }
                        }, this);

                        var classRef;
                        if (node.nodeName.indexOf('-') > -1 && (classRef = Li.getClass(node.nodeName.replace(/-/g, '.')))) {
                            control = this.bindingHandler.componenttag.init.call(this, node, tNode, classRef);
                            if (control.domTraverse) {
                                ret = control.domTraverse;
                            }
                        } else {
                            var parent = this.context.$root,
                                ref = node.getAttribute('ref');
                            if (ref && parent) {
                                ref.split('.').slice(0, -1).forEach(function (part) {
                                    parent = parent[part];
                                });
                                parent[ref.split('.').slice(-1)[0]] = node;
                                node.removeAttribute('ref');
                            }
                        }

                        if (ret) {
                            return ret;
                        }
                    }

                    //HTML comment node
                    if (node.nodeType === 8) {
                        var stmt = node.data.trim();

                        //Ignore all containerless statements beginning with "ko" if noConflict = true.
                        if (this.tpl.noConflict && (/^(ko |\/ko$)/).test(stmt)) {
                            return;
                        }

                        //Add node to this.nodeInfoList[].
                        this.addNodeInfo(node, tNode);

                        if ((/^(?:ko|hz) /).test(stmt)) {
                            commentStack.push(node);
                        } else if ((/^\/(?:ko|hz)$/).test(stmt)) {
                            var startNode = commentStack.pop();
                            this.getNodeInfo(startNode).blockEndNode = node;
                            this.getNodeInfo(node).blockStartNode = startNode;
                        }

                        match = stmt.match(util.regex.commentStatment);
                        if (match && this.bindingHandler[match[1].trim()]) {
                            binding = match[1].trim();
                            control = this.bindingHandler[binding].init.call(this,
                                node, binding, match[2], tNode, blocks) || {};
                            if (control.skipOtherbindings) {
                                return true;
                            }
                            if (control.ignoreTillNode) {
                                ignoreTillNode = control.ignoreTillNode;
                            }
                        }
                    }
                } else if (!isOpenTag) {
                    if (tNode.nodeType === 1 && tStack[tStack.length - 1] === tNode) {
                        stack.pop();
                        tStack.pop();
                    }
                    if (tNode === ignoreTillNode) {
                        ignoreTillNode = null;
                    }
                }
            }, this);

            this.components.forEach(function (item) {
                var parent = item.node.parentNode,
                    index = Li.childIndex(item.node);
                parent.insertBefore(item.cmp.view.toDocumentFragment(), parent.childNodes[index]);
                parent.removeChild(item.node);
            }, this);

            //Keep track of first and last child
            this.fragment = output;
            this.firstChild = output.firstChild;
            this.lastChild = output.lastChild;
            return output;
        },

        /**
         * Get all components used by this view and sub-views.
         */
        getComponents: function () {
            var components = this.components.map(function (o) {
                return o.cmp;
            });
            this.nodeInfoList.forEach(function (info) {
                if (info.views) {
                    info.views.forEach(function (view) {
                        components = components.concat(view.getComponents());
                    });
                }
            }, this);
            return components;
        },

        toString: function () {
            var frag = this.toDocumentFragment(), html = '';
            traverse(frag, frag, function (node, isOpenTag) {
                if (node.nodeType === 1) {
                    var tag = node.nodeName.toLowerCase();
                    if (isOpenTag) {
                        html += '<' + tag;
                        Li.slice(node.attributes).forEach(function (attr) {
                            html += ' ' + attr.name + '="' + attr.value.replace(/"/g, '&quot;') + '"';
                        });
                        html += (voidTags[tag] ? '/>' : '>');
                    } else if (!voidTags[tag]) {
                        html += '</' + tag + '>';
                    }
                }
                if (isOpenTag && node.nodeType === 3) {
                    var text = node.nodeValue || '';
                    //escape <,> and &. Except text node inside script or style tag.
                    if (!(/^(?:script|style)$/i).test(node.parentNode.nodeName)) {
                        text = text.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;");
                    }
                    html += text;
                }
                if (isOpenTag && node.nodeType === 8) {
                    html += '<!-- ' + node.data.trim() + ' -->';
                }
            }, this);
            return html;
        },

        /**
         * Removes view from document and marks this view as unused.
         */
        retire: function () {
            if (this.firstChild) {
                this.toDocumentFragment(); //if rendered, move nodes from document to DocumentFragment

                //Reset everything so that GC can free memory.
                this.fragment = null;
                this.firstChild = null;
                this.lastChild = null;

                this.nodeInfoList = []; //will contain the binding information for each node.
                this.nodeMap = {}; //used to quickly map a node to it's nodeInfo.

                this.components = [];
                this.componentMap = {};
            }
            this.retired = true;
        },

        /**
         * @private
         * @param {Node} node Node in View
         * @param {Node} tNode Corresponding Node in Template
         */
        addNodeInfo: function (node, tNode) {
            var nodeInfo = {
                node: node,
                tNode: tNode
            };
            this.nodeInfoList.push(nodeInfo);

            this.nodeMap[Li.getUID(node)] = nodeInfo;
        },

        /**
         * @private
         * @param {Node} node Node in View
         */
        getNodeInfo: function (node) {
            return this.nodeMap[Li.getUID(node)];
        },

        /**
         * @private
         * @param {Htmlizer} template Htmlizer instance that contains the body of the foreach statement
         * @param {Node} node
         * @param {Object} context
         * @param {Number} index Index at which items are to be inserted/removed.
         * @param {Number} removeLength Number of items to remove
         * @param {Array} items Array of items to insert to index
         * @param {String} as Name reference for item
         */
        spliceForEachItems: function (template, node, startIndex, removeLength, items, as) {
            var output = document.createDocumentFragment(),
                info = this.getNodeInfo(node);
            info.views = info.views || [];

            if (removeLength) {
                info.views.splice(startIndex, removeLength).forEach(function (view) {
                    view.retire();
                }, this);
            }

            var viewAtStartIndex = info.views[startIndex];

            items.forEach(function (item, index) {
                var newContext = this.getNewContext(this.context, this.data);
                //foreach special properties
                newContext.$data = newContext.$rawData = item;
                newContext.$index = Li.Observable(index + startIndex);

                if (as) {
                    newContext[as] = item;
                    //Add to _as so that sub templates can access them.
                    newContext._as = newContext._as || [];
                    newContext._as.push([as, item]);
                }

                var view = new Htmlizer.View(template, this.data, newContext, this);

                info.views.splice(index + startIndex, 0, view);

                //..finally execute
                output.appendChild(view.toDocumentFragment());
            }, this);

            //Update index of items that come after last inserted/removed value.
            if (Li) { //No need to do anything on on NodeJS
                for (var i = startIndex + items.length; i < info.views.length; i += 1) {
                    info.views[i].context.$index(i);
                }
            }

            if (viewAtStartIndex) {
                viewAtStartIndex.firstChild.parentNode.insertBefore(output, viewAtStartIndex.firstChild);
            } else {
                if (node.nodeType === 1) {
                    node.appendChild(output);
                } else if (node.nodeType === 8) {
                    //Render inner template and insert berfore this node.
                    node.parentNode.insertBefore(output, info.blockEndNode);
                }
            }
        },

        /**
         * Evaluate a JS expression for a binding on a node.
         * Sets states such that Observable that are called from eval, can indentify what binding etc is being evaluated.
         * @private
         */
        evaluate: function (binding, expr, node) {
            var old = Htmlizer.View.currentlyEvaluating;
            Htmlizer.View.currentlyEvaluating = this;

            this.currentlyEvaluating = {
                view: this,
                node: node,
                binding: binding,
                expr: expr
            };

            var value = saferEval.call(this.getRootView(), expr, this.context, this.data, node);

            if (value && Li.isObservable(value)) {
                value = value();
            }

            Htmlizer.View.currentlyEvaluating = old;
            this.currentlyEvaluating = null;

            return value;
        },

        /**
         * @private
         */
        getNewContext: function (parentContext, data) {
            var newContext = {
                $root: parentContext.$root,
                $parent: parentContext.$data,
                $parentContext: parentContext,
                $parents: ([data]).concat(parentContext.$parents),
                $data: data,
                $rawData: data
            };

            //Copy 'as' references from parent. This is done recursively, so it will have all the 'as' references from ancestors.
            if (parentContext._as) {
                newContext._as = parentContext._as.slice();
                newContext._as.forEach(function (tuple) {
                    newContext[tuple[0]] = tuple[1];
                });
            }
            return newContext;
        },

        /**
         * Used for making views with new context.
         * @private
         */
        makeView: function (template, newContext, data, node) {
            var view = new Htmlizer.View(template, data, newContext, this),
                info = this.getNodeInfo(node);

            info.views = info.views || [];
            info.views.push(view);

            return view;
        },

        /**
         * Find the root View object.
         * Most View's are in fact sub-views/intermediate views. So this is useful for debugging as well.
         * @private
         */
        getRootView: function () {
            if (!this.rootView) {
                var root = this;
                while (root.parentView) {
                    root = root.parentView;
                }
                this.rootView = root;
            }
            return this.rootView;
        }
    };

    var util = Htmlizer.util = {
        regex: {
            commentStatment: /(?:ko|hz)[ ]+([^:]+):(.+)/
        },
        /**
         * Parse html string using jQuery.parseHTML and also make sure script tags aren't removed.
         * @param {String} html
         * @private
         */
        parseHTML: function (html) {
            return $.parseHTML(html, document, true);
        },

        /**
         * @private
         * @param {Array[Node]} nodes
         */
        moveToNewFragment: function (nodes) {
            var frag = document.createDocumentFragment();
            nodes.forEach(function (n) {
                frag.appendChild(n);
            });
            return frag;
        },

        /**
         * @private
         * @param {Array[Node]} nodes
         */
        moveToFragment: function (nodes, fragment) {
            nodes.forEach(function (n) {
                fragment.appendChild(n);
            });
            return fragment;
        },

        /**
         * @private
         */
        parseObjectLiteral: function (objectLiteral) {
            var obj = {},
                tuples = parseObjectLiteral(objectLiteral);
            tuples.forEach(function (tuple) {
                obj[tuple[0]] = tuple[1];
            });
            return obj;
        },

        /**
         * Will stop iterating if callback returns true.
         * @private
         */
        forEachObjectLiteral: function (objectLiteral, callback, scope) {
            if (objectLiteral) {
                parseObjectLiteral(objectLiteral).some(function (tuple) {
                    return (callback.call(scope, tuple[0], tuple[1]) === true);
                });
            }
        },

        /**
         * @private
         * Get all immediate nodes between two given nodes.
         * @param {Boolean} inclusive Also include startNode and endNode in the returned array.
         */
        getImmediateNodes: function (frag, startNode, endNode, inclusive) {
            var nodes = [];
            if (inclusive) {
                nodes.push(startNode);
            }
            if (startNode === endNode) {
                return nodes;
            }
            traverse(startNode, frag, function (node, isOpenTag) {
                if (isOpenTag) {
                    if (inclusive && node.parentNode === startNode) {
                        return 'break';
                    }
                    if (node === endNode) {
                        return 'halt';
                    }
                    nodes.push(node);
                    return 'continue';
                }
            });
            if (inclusive) {
                nodes.push(endNode);
            }
            return nodes;
        },

        /**
         * @private
         */
        findBlockFromStartNode: function (blocks, node) {
            return blocks.filter(function (block) {
                return block.start === node;
            })[0] || null;
        }
    };

    return Htmlizer;
}, function () {
    //Templates could be attempting to reference undefined variables. Hence try catch is required.
    if (arguments.length === 4) {
        var evaluator;
        if (!(evaluator = this.exprEvaluatorCache[arguments[0]])) {
            evaluator = this.exprEvaluatorCache[arguments[0]] = new Function('$context', '$data', '$element', 'with($context){with($data){return ' + arguments[0] + '}}');
        }
        try {
            return evaluator(arguments[1] || {}, arguments[2] || {}, arguments[3]);
        } catch (e) {
            console.warn('Warning: ' + e.stack);
        }
    } else {
        throw new Error('Expression evaluator needs at least 4 arguments.');
    }
}));
