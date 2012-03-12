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

function Tasked (dburl) {
  var self = this
  self.url = dburl
  self.follow = follow(dburl)
  self.couch = couch(dburl)
  self.updating = false
  
  self.follow.include_docs = true
  self.follow.on('change', function (change) {
    self.emit('tasked.update')
  })

  self.interval = setInterval(function () {
    // Every minute force re-check
    self.updating = false
    self.emit('tasked.update')
  }, 60 * 1000)

  self.on('tasked.update', function () {
    if (!self.updating) {
      self.couch.design('tasked').view('tasks').query({}, function (e, results) {
        if (e) return console.error(e)
        if (results.rows.length) {
          results.rows.forEach(function (row) {
            self.emit('tasked.check', row.id)
          })
        }
        self.updating = false
      })
    } 
    self.updating = true
  })

  self.on('tasked.check', function (id) {
    function check () {
      self.couch.get(id, function (e, doc) {
        if (e) return console.error(e)
        if (doc.state === 'new') {
          doc.state = 'processing'
          self.couch.post(doc, function (e, info) {
            if (e) return // someone else got it first
            doc._rev = info.rev
            self.emit('tasked.new', doc)
          })        
        }
      })
    }

    if (self.delay) {
      setTimeout(check, Math.random() * 111)
    } else {
      check()
    }
  })

  self.on('tasked.new', function (doc) {
    var task = new Task(doc, function (e) {
      function update (doc) {
        doc.state = 'complete'
        doc.results = task.results
        doc.errors = task.errors
      }

      self.couch.update(doc._id, update, function (e, info) {
        doc._rev = info.rev
        self.follow.emit('complete', doc)
      })
    })
    task.t = self
    self.emit(doc.type, task)
  })
}
util.inherits(Tasked, events.EventEmitter)
Tasked.prototype.close = function () {
  clearInterval(this.interval)
  this.follow.stop()
}

module.exports = function (dburl) {
  return new Tasked(dburl)
}

module.exports.provision = function provision (url, cb) {
  var view = (function (doc) {
    if (doc.state === 'new') emit(1, 1)
  }).toString()
  couch(url).update('_design/tasked', function (doc) {
    doc.views = {tasks:{map:view}}
  }, cb)
}

