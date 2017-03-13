'use strict';

/**
 * To support running mock queries, we use this object to queue results for queries. This
 * is to provide full control over the objects that are returned and do so in a way that
 * allows you to target specific code paths.
 * 
 * Queries are queued in a "first in, last out" manner, so they should be inserted in the
 * order your code would expect them in. The queue itself does no checking or validation
 * for what types of objects are being passed around except in the case of failures
 * (see `$queueFailure`).
 * 
 * **Note:** This is not an equivalent mock of Sequelize's built in `QueryInterface` at
 * the moment. The built in object for Sequelize is undocumented and is marked as `@private`
 * in their code, meaning it is not likely something to be relied on. If this changes it
 * can be mocked here. Functions have been prefixed with the mock prefix (`$`) for this
 * reason.
 * 
 * @name QueryInterface
 * @fileOverview The mock QueryInterface base that is used for returning results from queries for tests
 **/

var bluebird = require('bluebird'),
	_ = require('lodash'),
	Errors = require('./errors');

/**
 * The `QueryInterface` class is used to provide common mock query functionality. New
 * instances of this class should mostly be created internally, however the functions on
 * the class are exposed on objects utilize this class.
 * 
 * @class QueryInterface
 * @param {Object} [options] Options for the query interface to use
 * @param {QueryInterface} [options.parent] Parent `QueryInterface` object to propagate up to
 * @param {Boolean} [options.stopPropagation] Flag indicating if we should not propagate to the parent
 * @param {Boolean} [options.createdDefault] Default value to be used for if something has been created if one is not passed in by the query. Defaults to true
 * @param {Function} [options.fallbackFn] Default function to call as a fallback if nothing is left in the queue and a fallback function is not passed in with the query
 **/
function QueryInterface (options) {
	this.options = options || {};
	this._results = [];
}

/**
 * Queue a new success result from the mock database
 * 
 * @instance
 * @param {Any} [result] The object or value to be returned as the result of a query
 * @param {Object} [options] Options used when returning the result
 * @param {Boolean} [options.wasCreated] Optional flag if a query requires a `created` value in the return indicating if the object was "created" in the DB
 * @param {Array<Any>} [options.affectedRows] Optional array of objects if the query requires an `affectedRows` return value
 * @return {QueryInterface} this
 **/
QueryInterface.prototype.$queueResult = function (result, options) {
	this._results.push({
		content: result,
		options: options || {},
		type: 'Success',
	});
	
	return this;
};

/**
 * Queue a new error or failure result from the mock database. This will cause a query
 * to be rejected with the given error/failure object. The error is converted into a
 * `BaseError` object unless specified by the `options.convertNonErrors` parameter.
 * 
 * @instance
 * @name $queueFailure
 * @param {Any} [error] The object or value to be returned as the failure for a query
 * @param {Object} [options] Options used when returning the result
 * @param {Boolean} [options.convertNonErrors] Flag indicating if non `Error` objects should be allowed. Defaults to true
 * @return {QueryInterface} this
 **/
QueryInterface.prototype.$queueError = QueryInterface.prototype.$queueFailure = function (error, options) {
	// Rejections from Sequelize will almost always be errors, so we convert to an error by default
	if((!options || options.convertNonErrors !== false) && !(error instanceof Error)) {
		// Convert non-Error objects to BaseError objects if we haven't specified otherwise
		error = new Errors.BaseError(error);
	}
	
	this._results.push({
		content: error,
		options: options || {},
		type: 'Failure',
	});
	
	return this;
};

/**
 * Clears any queued query results
 * 
 * @instance
 * @param {Object} [options] Options used when returning the result
 * @param {Boolean} [options.propagateClear] Propagate this clear up to any parent `QueryInterface`s. Defaults to false
 * @return {QueryInterface} this
 **/
QueryInterface.prototype.$clearQueue = function (options) {
	options = options || {};
	this._results = [];
	
	// If we should also clear any results that would be added through propagation
	// then we also need to trigger $clearQueue on any parent QueryInterface
	if(options.propagateClear && this.options.parent) {
		this.options.parent.$clearQueue(options);
	}
	
	return this;
};

/**
 * This is the mock method for getting results from the `QueryInterface`. This function
 * will get the next result in the queue and return that wrapped in a promise.
 * 
 * @instance
 * @param {Object} [options] Options used for this query
 * @param {Function} [options.fallbackFn] A fallback function to run if there are no results queued
 * @param {Boolean} [options.includeCreated] Flag indicating if a `created` value should be returned with the result for this query. Defaults to false
 * @param {Boolean} [options.includeAffectedRows] Flag indicating if the query expects `affectedRows` in the returned result parameters. Defautls to false
 * @param {Boolean} [options.stopPropagation] Flag indicating if result queue propagation should be stopped on this query. Defaults to false
 * @return {Promise}
 **/
QueryInterface.prototype.$query = function (options) {
	options = options || {};
	
	var fallbackFn = options.fallbackFn || this.options.fallbackFn;
	
	if(this._results.length) {
		var result = this._results.shift();
		
		if(typeof result !== 'object' || !(result.type === 'Failure' || result.type === 'Success')) {
			throw new Errors.InvalidQueryResultError();
		}
		
		if(result.type == 'Failure') {
			return bluebird.reject(result.content);
		}
		
		if(options.includeCreated) {
			var created = true;
			if(typeof this.options.createdDefault !== 'undefined') {
				created = !!this.options.createdDefault;
			}
			if(typeof result.options.wasCreated !== 'undefined') {
				created = !!result.options.wasCreated;
			}
			
			return bluebird.resolve([result.content, created]);
		}
		if (options.includeAffectedRows) {
			var affectedRows = [];
			if(result.options.affectedRows instanceof Array) {
				affectedRows = result.options.affectedRows;
			}
			
			return bluebird.resolve([result.content, affectedRows]);
		}
		return bluebird.resolve(result.content);
		
	} else if (!options.stopPropagation && !this.options.stopPropagation && this.options.parent) {
		return this.options.parent.$query(options);
	} else if (fallbackFn){
		return fallbackFn();
	} else {
		throw new Errors.EmptyQueryQueueError();
	}
};

module.exports = QueryInterface;