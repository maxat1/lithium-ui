/*jslint evil: true*/

if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

(function (factory, saferEval) {
    define(['jquery-node', './util/js-object-literal-parse', './Observable'], function ($, parseObjectLiteral, Lui) {
        Lui.Template = factory.call(this, saferEval, $, parseObjectLiteral, Lui);
        return Lui;
    }.bind(this));
}(function (saferEval, $, parseObjectLiteral, Lui) {
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
        traverse = Lui.util.traverse;

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
                id = 1,
                getId = function () {
                    return 'hz-' + id++;
                },
                blockNodes, tempFrag;
            traverse(frag, frag, function (node, isOpenTag) {
                if (isOpenTag) {
                    depth += 1;
                    var nodeInfo = {},
                        bindings;
                    if (node.nodeType === 1) { //element
                        var classRef;
                        if (util.regex.customElement.test(node.nodeName)) {
                            var className = node.nodeName.replace(/^X\-/, '')
                                .replace(/^L\-/, 'Lui.')
                                .replace(/-/g, '.');
                            classRef = Lui.getClass(className);
                        }

                        var bindOpts = node.getAttribute(this.noConflict ? 'data-htmlizer' : 'data-bind');
                        if (bindOpts) {
                            this.checkForConflictingBindings(bindOpts, classRef);
                            bindings = util.parseObjectLiteral(bindOpts);
                            node._id = getId();
                            nodeInfo.node = node;
                            nodeInfo.depth = depth;
                            nodeInfo.binding = bindOpts;
                            if (bindings.foreach || bindings['with'] || bindings['if'] || bindings.ifnot) {
                                tempFrag = util.moveToNewFragment(util.slice(node.childNodes));
                                nodeInfo.subTpl = new Htmlizer(tempFrag, $.extend({depth: depth}, this.cfg));
                            }
                            this.nodeInfoList.push(nodeInfo);
                            this.nodeMap[node._id] = nodeInfo;
                        }

                        if (classRef) { //do not add component inner config to nodeInfoList
                            return 'continue';
                        }
                    }

                    //HTML comment node
                    if (node.nodeType === 8) {
                        var stmt = node.data.trim();

                        //Ignore all containerless statements beginning with "ko" if noConflict = true.
                        if (this.noConflict && (/^(ko |\/ko$)/).test(stmt)) {
                            return;
                        }

                        var block = util.findBlockFromStartNode(blocks, node);
                        if (block) {
                            node._id = getId();
                            nodeInfo.node = node;
                            nodeInfo.depth = depth;
                            nodeInfo.block = block;
                            if (block.key === 'foreach' || block.key === 'with' || block.key === 'if' || block.key === 'ifnot') {
                                blockNodes = util.getImmediateNodes(frag, block.start, block.end);
                                tempFrag = util.moveToNewFragment(blockNodes);
                                nodeInfo.subTpl = new Htmlizer(tempFrag, $.extend({depth: depth}, this.cfg));
                            }
                            this.nodeInfoList.push(nodeInfo);
                            this.nodeMap[node._id] = nodeInfo;
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
            return this.nodeMap[node._id];
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
     * @param {Lui.Template} template Lui.Template instance
     * @param {Object} data Any data
     * @param {Object} context [Context] in which this view should run. Used internally.
     * @param {Lui.Template.View} [parentView] parent of this view. Used internally.
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

        //Partially render the view, as Components and sub-components need to be constructed before render.
        this.toDocumentFragment();
    };

    Htmlizer.View.uid = (function () {
        var id = 1;
        return function () {
            return '' + id++;
        };
    }());
    Htmlizer.View.saferEval = saferEval;

    Htmlizer.View.prototype = {
        bindingHandler: {
            component: {
                init: function (node, tNode) {
                    var className = node.nodeName.replace(/^X\-/, '')
                            .replace(/^L\-/, 'Lui.')
                            .replace(/-/g, '.'),
                        classRef = Lui.getClass(className),
                        cfg, cmp;
                    node.innerHTML = tNode.innerHTML;
                    if (classRef) {
                        //Parse node to a config
                        if (classRef.prototype.makeConfigFromView) {
                            cfg = classRef.prototype.makeConfigFromView(node, cfg);
                        } else {
                            cfg = {
                                type: classRef.prototype.type
                            };
                        }
                        cfg.parent = this.context.$root;

                        //Create instance from config
                        cmp = new classRef(cfg);
                        //Resolve reference using ref attribute
                        if (cfg.ref && cfg.parent) {
                            var backsRegEx = /\.\.\//g,
                                backs = cfg.ref.match(backsRegEx);
                            cfg.ref = cfg.ref.replace(backsRegEx, '');

                            var rel = cfg.parent;
                            for (backs = (backs ? backs.length : 0); backs > 0; backs -= 1) {
                                rel = rel.parent;
                            }

                            rel[cfg.ref] = cmp;
                            delete cmp.ref;
                        }

                        //Add to components list
                        this.components = this.components || [];
                        this.components.push({cmp: cmp, node: node});

                        return {domTraverse: 'continue'}; //ignore inner content
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
                        }
                        node.parentNode.removeChild(node);
                        var block = util.findBlockFromStartNode(blocks, tNode);
                        return {ignoreTillNode: block.end};
                    }
                }
            },
            "if": {
                init: function (node, binding, expr, tNode) {
                    var val = this.evaluate(binding, expr, node),
                        tpl = this.tpl.getBindingInfo(tNode).subTpl,
                        view = this.makeView(tpl, this.context, this.data, node);
                    if (val) {
                        var tempFrag = view.toDocumentFragment();
                        if (node.nodeType === 1) {
                            node.appendChild(tempFrag);
                        } else if (node.nodeType === 8) {
                            node.parentNode.insertBefore(tempFrag, node.nextSibling);
                        }
                    }
                },
                update: function (node, binding, expr) {
                    var val = this.evaluate(binding, expr, node),
                        view = this.getNodeInfo(node).views[0],
                        tempFrag = view.toDocumentFragment(); //if rendered, move nodes from document to DocumentFragment

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
                        tpl = this.tpl.getBindingInfo(tNode).subTpl,
                        as;

                    if (node.nodeType === 1) {
                        expr = this.parseObjectLiteral(node.getAttribute('data-bind')).foreach;
                    } else if (node.nodeType === 8) {
                        var match = node.data.match(util.regex.commentStatment);
                        expr = match[2];
                    }

                    expr = expr.trim();
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
                            var val = this.evaluate({binding: binding, attr: attr}, value, node);
                            if (typeof val === 'string' || typeof val === 'number') {
                                node.setAttribute(attr, val);
                            }
                        }, this);
                    }
                },
                update: function (node, binding, expr, extraInfo) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val || typeof val === 'string' || typeof val === 'number') {
                            node.setAttribute(extraInfo.attr, val);
                        } else { //undefined, null, false
                            node.removeAttribute(extraInfo.attr);
                        }
                    }
                }
            },
            css: {
                init: function (node, binding, expr) {
                    if (node.nodeType === 1) {
                        util.forEachObjectLiteral(expr.slice(1, -1), function (className, expr) {
                            var val = this.evaluate({binding: binding, className: className}, expr, node);
                            if (val) {
                                $(node).addClass(className);
                            }
                        }, this);
                    }
                },
                update: function (node, binding, expr, extraInfo) {
                    if (node.nodeType === 1) {
                        var val = this.evaluate(binding, expr, node);
                        if (val) {
                            $(node).addClass(extraInfo.className);
                        } else {
                            $(node).removeClass(extraInfo.className);
                        }
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
                                var val = this.evaluate({binding: binding, prop: prop}, expr, node) || null;
                                node.style.setProperty(prop.replace(/[A-Z]/g, toCssProp), val);
                            }, this);
                        }
                    },
                    update: function (node, binding, expr, extraInfo) {
                        if (node.nodeType === 1) {
                            var val = this.evaluate(binding, expr, node);
                            if (val || typeof val === 'string' || typeof val === 'number') {
                                node.style.setProperty(extraInfo.prop.replace(/[A-Z]/g, toCssProp), val);
                            } else { //undefined, null, false
                                node.style.removeProperty(extraInfo.prop.replace(/[A-Z]/g, toCssProp));
                            }
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
                        } else {
                            node.removeAttribute('checked');
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
                    this.fragment = util.moveToNewFragment(nodes);
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

                        if (util.regex.customElement.test(node.nodeName)) {
                            control = this.bindingHandler.component.init.call(this, node, tNode);
                            if (control.domTraverse) {
                                ret = control.domTraverse;
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

            //We could have iterated through this.components array and replaced component node with cmp.view.toDocumentFragment()
            //..but that isn't suited for renderers that needs to initiate AJAX etc. So the right way is to call
            //component's render method.
            //I can't call it here, because Component hasn't called component.init() yet.
            //i.e in Component.js constructor, toDocumentFragment() is called before init().
            //Now that is because, init cannot be done until all instances are created and refs are resolved properly.

            //Keep track of first and last child
            this.fragment = output;
            this.firstChild = output.firstChild;
            this.lastChild = output.lastChild;
            return output;
        },

        /**
         * Renders and returns a DocumentFragment.
         */
        render: function () {
            //Render components
            (this.components || []).forEach(function (item) {
                var parent = item.node.parentNode,
                    index = Lui.util.childIndex(item.node);
                item.cmp.render(parent, index);
                if (item.node === this.firstChild) {
                    this.firstChild = parent.childNodes[index];
                }
                if (item.node === this.lastChild) {
                    this.lastChild = parent.childNodes[index];
                }
                parent.removeChild(item.node);
            }, this);

            //Call render() on sub views as well.
            this.nodeInfoList.forEach(function (info) {
                if (info.views) {
                    info.views.forEach(function (view) {
                        view.render();
                    });
                }
            }, this);

            return this.fragment;
        },

        toString: function () {
            var frag = this.toDocumentFragment(), html = '';
            traverse(frag, frag, function (node, isOpenTag) {
                if (node.nodeType === 1) {
                    var tag = node.nodeName.toLowerCase();
                    if (isOpenTag) {
                        html += '<' + tag;
                        util.slice(node.attributes).forEach(function (attr) {
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
         * Removs view from document and marks this view as unused.
         */
        retire: function () {
            if (this.firstChild) {
                this.toDocumentFragment(); //if rendered, move nodes from document to DocumentFragment
            }
            this.retired = false;
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

            node._uid = Htmlizer.View.uid();
            this.nodeMap[node._uid] = nodeInfo;
        },

        /**
         * @private
         * @param {Node} node Node in View
         */
        getNodeInfo: function (node) {
            return this.nodeMap[node._uid];
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
                newContext.$index = Lui.Observable(index + startIndex);

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
            if (Lui) { //No need to do anything on on NodeJS
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
         * @private
         */
        evaluate: function (binding, expr, node) {
            var old = Htmlizer.View.currentlyExecuting;
            Htmlizer.View.currentlyEvaluating = this;

            var extraInfo;
            if (typeof binding !== 'string') {
                extraInfo = binding;
                binding = extraInfo.binding;
                delete extraInfo.binding;
            }
            this.currentlyEvaluating = {
                view: this,
                node: node,
                binding: binding,
                expr: expr,
                extraInfo: extraInfo
            };

            var value = saferEval.call(null, expr, this.context, this.data, node);

            if (value && value.isLuiObservable) {
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
        }
    };

    var util = Htmlizer.util = {
        regex: {
            customElement: /^(X|L)\-/,
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
         */
        slice: function (arrlike, index) {
            return Array.prototype.slice.call(arrlike, index);
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
        try {
            return (new Function('$context', '$data', '$element', 'with($context){with($data){return ' + arguments[0] + '}}'))(arguments[1] || {}, arguments[2] || {}, arguments[3]);
        } catch (e) {}
    } else {
        throw new Error('Expression evaluator needs at least 4 arguments.');
    }
}));
