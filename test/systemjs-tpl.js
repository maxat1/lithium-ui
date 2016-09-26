// Written by Gustav Nikolaj <gno@one.com>

function getBaseNameFromUrl(url) {
    return url.split('/').pop().replace(/\.ko$/, '');
}

var injectTemplates = function(templates) {
    templates.forEach(function(tpl) {
        if (tpl.content.trim().slice(0, 7) === '<script') {
            var s = document.createElement('head');
            s.innerHTML = tpl.content;
            while (s.firstElementChild) {
                document.head.appendChild(s.firstElementChild);
            }
        } else {
            var s = document.createElement('script');
            s.id = tpl.id;
            s.innerHTML = tpl.content;
            s.type = 'text/html';
            document.head.appendChild(s);
        }
    });
};

module.exports = {
    fetch: function (load, fetch) {
        var builder = this.builder;
        return fetch(load)
        .then(function(source) {
            if (builder) {
                load.metadata.templateContent = source;
            } else
                injectTemplates([{
                    id: getBaseNameFromUrl(load.address),
                    content: source
                }]);
            return '';
        });
    },
    bundle: function(loads) {
        return {
            source: '(' + injectTemplates.toString() + ')(' + JSON.stringify(loads.map(function(load) {
                return {
                    id: getBaseNameFromUrl(load.address),
                    content: load.metadata.templateContent
                };
            }), null, 2) + ');'
        };
    },
    listAssets: function (loads) {
        return loads.map(function (load) {
            return {
                url: load.address,
                source: load.metadata.templateContent,
                type: 'knockout-template'
            };
        });
    }
};
