var follow = require('follow')
  , couch = require('couch')
  , events = require('events')
  , util = require('util')
  ;
  
function Task (info, cb) {
  var self = this
  self.info = info
  self.promises = {}
  self.counter = 0
  self.results = {}
  self.errors = {}
  process.nextTick(function () {
    if (self.counter === 0) self.emit('finish', self.results)
  })
  // supress throw
  self.on('error', function (e) {
    console.error(e)
  })
  self.on('finish', function () {
    cb(self.results, self.errors)
  })
}
util.inherits(Task, events.EventEmitter)
Task.prototype.promise = function (name, cb) {
  if (name === 'error') throw new Error("You cannot name a promise 'error'")
  if (name === 'finish') throw new Error("You cannot name a promise 'finish'")
  if (name === 'resolved') throw new Error("You cannot name a promise 'resolved'")
  var self = this;
  self.counter += 1
  self.promises[name] = function (e, result) {
    self.emit('resolved', name, e, result)
    self.emit(name, e, result)
    if (e) {
      e.promise = name
      self.errors[name] = e
      self.emit('error', e, name)
    } else {
      self.results[name] = result
    }
    if (cb) cb(e, result)
    self.counter = self.counter - 1
    if (self.counter === 0) self.emit('finish', self.results)
  }
  return self.promises[name]
}


module.exports = function (dburl) {
  var f = follow(dburl)
    , c = couch(dburl)
    , e = new events.EventEmitter()
    ;
  f.include_docs = true
  f.on('change', function (change) {
    if (change.doc.state === 'new') {
      var completed = false
        , processing = false
        , finished = false
        ;
      function finish (task) {
        finished = true
        
        function update (doc) {
          doc.state = 'complete'
          doc.results = task.results
          doc.errors = task.errors
        }
        
        c.update(change.doc._id, update, function (e, info) {
          change.doc._rev = info.rev
          f.emit('complete', change)
        })
      
      }
      f.emit('new', change)
      
      var task = new Task(change.doc, function (e) {
        completed = true
        if (processing) finish(task)
      })
      e.emit(change.doc.type, task)
      
      change.doc.state = 'processing'
      c.post(change.doc, function (e, info) {
        if (e) return f.emit('error', e)
        change.doc._rev = info.rev
        processing = true
        if (completed && !finished) finish(task) 
      })
    }
  })
  return e
}

