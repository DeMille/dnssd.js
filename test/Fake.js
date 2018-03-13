const Socket = require('dgram').Socket;

const _ = require('lodash');
const sinon = require('sinon');

const dir = process['test-dir'] || '../src';
const EventEmitter             = require(dir + '/EventEmitter');
const Query                    = require(dir + '/Query');
const Probe                    = require(dir + '/Probe');
const Response                 = require(dir + '/Response');
const ExpiringRecordCollection = require(dir + '/ExpiringRecordCollection');
const NetworkInterface         = require(dir + '/NetworkInterface');
const DisposableInterface      = require(dir + '/DisposableInterface');


// adds reset method that resets all of the instances stubbed methods
function addReset(stub) {
  stub.reset = function() {
    _(stub).forOwn((value, key) => {
      if (stub[key] && typeof stub[key].reset === 'function') {
        stub[key].reset();
      }
    });
  };
}


function addProps(stub, props) {
  _.each(props, (value, key) => { stub[key] = value; });
}


function addEventEmitter(stub) {
  // dirty prototype rejig
  _.forIn(EventEmitter.prototype, (value, key) => { stub[key] = value; });

  // need to run contructor on it
  EventEmitter.call(stub);

  // make em spies
  sinon.spy(stub, 'using');
  sinon.spy(stub, 'emit');
  sinon.spy(stub, 'on');
  sinon.spy(stub, 'once');
  sinon.spy(stub, 'off');
  sinon.spy(stub, 'removeListener');
  sinon.spy(stub, 'removeAllListeners');
  sinon.spy(stub, 'removeListenersCreatedBy');

  // add to reset: reset stubs *and* remove listeners
  const original = stub.reset;

  stub.reset = function() {
    original();
    stub.removeAllListeners();
  };
}


/*
 * Stubs:
 */

function EventEmitterStub(props) {
  const stub = sinon.createStubInstance(EventEmitter);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.using.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();
  stub.removeListener.returnsThis();
  stub.removeAllListeners.returnsThis();
  stub.removeListenersCreatedBy.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function ExpRecCollectionStub(props) {
  const stub = sinon.createStubInstance(ExpiringRecordCollection);
  addReset(stub);
  addProps(stub, props);

  addEventEmitter(stub);
  return stub;
}


function NetworkInterfaceStub(props) {
  const stub = sinon.createStubInstance(NetworkInterface);
  addReset(stub);
  addProps(stub, props);

  stub.bind.returns(Promise.resolve());

  addEventEmitter(stub);
  return stub;
}


function DisposableInterfaceStub(props) {
  const stub = sinon.createStubInstance(DisposableInterface);
  addReset(stub);
  addProps(stub, props);

  stub.bind.returns(Promise.resolve());

  addEventEmitter(stub);
  return stub;
}


function SocketStub(props) {
  const stub = sinon.createStubInstance(Socket);
  addReset(stub);
  addProps(stub, props);

  addEventEmitter(stub);
  return stub;
}


function ProbeStub(props) {
  const stub = sinon.createStubInstance(Probe);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.bridgeable.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function QueryStub(props) {
  const stub = sinon.createStubInstance(Query);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.setTimeout.returnsThis();
  stub.continuous.returnsThis();
  stub.ignoreCache.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function MulticastResponseStub(props) {
  const stub = sinon.createStubInstance(Response.Multicast);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.repeat.returnsThis();
  stub.defensive.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function UnicastResponseStub(props) {
  const stub = sinon.createStubInstance(Response.Unicast);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.defensive.returnsThis();
  stub.respondTo.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function GoodbyeStub(props) {
  const stub = sinon.createStubInstance(Response.Goodbye);
  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.add.returnsThis();
  stub.start.returnsThis();
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.repeat.returnsThis();
  stub.defensive.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function ServiceResolverStub(props) {
  const stub = {
    start     : sinon.stub(),
    stop      : sinon.stub(),
    service   : sinon.stub(),
    isResolved: sinon.stub(),
    emit      : sinon.stub(),
    on        : sinon.stub(),
    once      : sinon.stub(),
    off       : sinon.stub(),
  };

  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();

  addEventEmitter(stub);
  return stub;
}


function ResponderStub(props) {
  const stub = {
    start     : sinon.stub(),
    stop      : sinon.stub(),
    goodbye   : sinon.stub(),
    updateEach: sinon.stub(),
    getRecords: sinon.stub(),
    emit      : sinon.stub(),
    on        : sinon.stub(),
    once      : sinon.stub(),
    off       : sinon.stub(),
  };

  addReset(stub);
  addProps(stub, props);

  // chainable methods
  stub.on.returnsThis();
  stub.once.returnsThis();
  stub.off.returnsThis();

  // callback methods
  stub.goodbye.yields();

  addEventEmitter(stub);
  return stub;
}


module.exports = {
  EventEmitter       : EventEmitterStub,
  ExpRecCollection   : ExpRecCollectionStub,
  NetworkInterface   : NetworkInterfaceStub,
  DisposableInterface: DisposableInterfaceStub,
  Socket             : SocketStub,
  Probe              : ProbeStub,
  Query              : QueryStub,
  MulticastResponse  : MulticastResponseStub,
  UnicastResponse    : UnicastResponseStub,
  Goodbye            : GoodbyeStub,
  ServiceResolver    : ServiceResolverStub,
  Responder          : ResponderStub,
};
