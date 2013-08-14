/*global document, XMLHttpRequest, localStorage, basket, RSVP*/
(function( window, document ) {
	'use strict';

	var head = document.head || document.getElementsByTagName('head')[0];
	var defaultExpiration = 5000;
	var group = 0;
	var handler = [];

	// localstorage API
	var ls = {
		prefix: 'basket-',
		add: function( obj ) {

			var key = obj.key,
				storeObj = obj;

			try {
				localStorage.setItem( this.prefix + key, JSON.stringify( storeObj ) );
				return true;
			} catch( e ) {
				if ( e.name.toUpperCase().indexOf('QUOTA') >= 0 ) {
					var item;
					var tempScripts = [];

					for ( item in localStorage ) {
						if ( item.indexOf( this.prefix ) === 0 ) {
							tempScripts.push( JSON.parse( localStorage[ item ] ) );
						}
					}

					if ( tempScripts.length ) {
						tempScripts.sort(function( a, b ) {
							return a.stamp - b.stamp;
						});

						this.remove( tempScripts[ 0 ].key );

						return this.add( obj );

					} else {
						// no files to remove. Larger than available quota
						return;
					}

				} else {
					// some other error
					return;
				}
			}
		},
		remove : function( key ) {
			localStorage.removeItem( this.prefix + key );
		},
		get : function( key ) {
			var item = localStorage.getItem( this.prefix + key );
			try	{
				return JSON.parse( item || 'false' );
			} catch( e ) {
				return false;
			}
		},
		clear: function( expired ) {
			var item, key;
			var now = +new Date();

			for ( item in localStorage ) {
				key = item.split( this.prefix )[ 1 ];
				if ( key && ( !expired || this.get( key ).expire <= now ) ) {
					this.remove( key );
				}
			}

			return this;
		}
	};

	// Resources API
	var resources = {
		callbackGroup: [],
		all : [],
		fetch : function(group, args){
			var i, l;

			for ( i = 0, l = args.length; i < l; i++ ) {
				this.all.push({
					group: group,
					obj: new Resource( args[ i ], group )
				});
			}
			return this;
		},
		getContent : function( obj ) {
			obj.status = "fetchind";
			var xhr = new XMLHttpRequest();
			xhr.open( 'GET', obj.url );
			xhr.onreadystatechange = function() {
				if ( xhr.readyState === 4 ) {
					obj.xhr = {
						status: xhr.status,
						data: xhr.responseText
					}
					resources.resolve( obj );
				}
			};
			xhr.send();
		},
		resolve : function( obj ) {
			if( obj.status === "fetchind" ){
				if( obj.xhr.status === 200 ) {
					obj.status = "resolved";
					obj.wrap();
				}else{
					obj.status = "rejected";
				}
			}

			if ( obj.status !== "rejected" ) {

			}

			this.executeCallbackGroup( obj.group );
		},
		resolveHandler: function(obj){
			if (obj.execute) {
				handler.forEach(function( handle ) {
					if ( handle.process(obj) ) {
						obj.injected = true;
					}
				})
			}
		},
		executeCallbackGroup: function( group ) {
			var counter = 0,
				ready = 0,
				elementsError = [],
				elements = [];

			this.all.some(function(e,f){

				if ( e.group == group ) {

					elements.push(e);
					counter++;


					if( e.obj.status === "resolved" || e.obj.status === "cached" ) {
						if(!elementsError.length){
							resources.resolveHandler( e.obj );
						}
						if (e.obj.status === "resolved") {
							ls.add( e.obj );
						}
						ready++;

					}else if ( e.obj.status === "rejected" ) {

						ready++;
						elementsError.push(e.obj);

					}else{
						return true;
					}
				}
			});
			if(this.callbackGroup[group] && counter === ready) {
				this.callbackGroup[group].forEach(function( callback ) {
					if (!elementsError.length && callback[0]){

						callback[0].call(elements);

					}else if( callback[1] ){

						callback[1].call(elements, elementsError);

					}
				});

			}
		}
	};

	var Resource = function( obj, group ) {
		//check for url
		if ( !obj.url ) {
			return;
		}
		// declare

		this.url = obj.url;
		this.key =  ( obj.key || obj.url );
		this.source = ls.get( this.key );

		this.unique = obj.unique;
		this.group = group;
		this.execute = this.source.execute || (obj.execute !== false);
		this.expire = this.source.expire || obj.expire;
		this.stamp = this.source.stamp || false;
		this.xhr = this.source.xhr || {};
		/*
			status
				pendent
				fetchind
				resolved
				rejected
		*/
		this.status = (this.source) ? "cached" : "pendent";
		// new controller
		this.injected = false;

		// methods
		this.isValid = obj.isValid || function() {
			return  (!this.source || this.source.expire - +new Date() < 0  || this.unique !== this.source.unique || (basket.isValidItem && !basket.isValidItem(this)));
		}
		this.wrap = function(){
			var now = +new Date();
			this.stamp = now;
			this.expire = now + ( ( this.expire || defaultExpiration ) * 60 * 60 * 1000 );
		}

		// check is valid
		if (this.isValid()) {
			if ( this.unique ) {
				// set parameter to prevent browser cache
				this.url += ( ( this.url.indexOf('?') > 0 ) ? '&' : '?' ) + 'basket-unique=' + this.unique;
			}

			resources.getContent( this );
		}else{
			var obj = this;
			setTimeout(function(){
				resources.resolve( obj );
			},200);
		}

		return this;
	};

	// make public
	window.basket = {
		require: function() {
			group++;
			resources.fetch( group, arguments );
			return {
				then:function( callback, error ){
					if( !resources.callbackGroup[ group ] ){
						resources.callbackGroup[ group ] = [];
					}
					resources.callbackGroup[ group ].push([callback, error]);
					return basket;
				},
				thenRequire:function(){
					resources.fetch( group, arguments );
					return this;
				}
			};
		},
		remove: function( key ) {
			ls.remove();
			return this;
		},
		get: function( key ) {
			return ls.get( key );
		},
		clear: function( expired ) {
			ls.clear( expired );
			return this;
		},
		addHandler: function() {
			handler.push( arguments[0] )
		},
		isValidItem: null
	};

	// delete expired keys
	ls.clear( true );

	basket.addHandler({
		process: function(obj) {
			var script = document.createElement('script');
			script.defer = true;
			// Have to use .text, since we support IE8,
			// which won't allow appending to a script
			script.text = obj.xhr.data;
			head.appendChild( script );

			return true;
		}
	});
})( this, document );
