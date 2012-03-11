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
    , t = new events.EventEmitter()
    , checking = false
    ;
  f.include_docs = true
  f.on('change', function (change) {
    t.emit('tasked.update')
  })
  
  var interval = setInterval(function () {
    // Every minute force re-check
    checking = false
    t.emit('tasked.update')
  }, 60 * 1000)
  
  t.close = function () {
    clearInterval(interval)
  }
  
  t.on('tasked.update', function () {
    if (!checking) {
      c.design('tasked').view('tasks').query({}, function (e, results) {
        if (e) return console.error(e)
        if (results.rows.length) {
          results.rows.forEach(function (row) {
            t.emit('tasked.check', row.id)
          })
        }
        checking = false
      })
    } 
    checking = true
  })
  
  t.on('tasked.check', function (id) {
    function check () {
      c.get(id, function (e, doc) {
        if (e) return console.error(e)
        if (doc.state === 'new') {
          doc.state = 'processing'
          c.post(doc, function (e, info) {
            if (e) return // someone else got it first
            doc._rev = info.rev
            t.emit('tasked.new', doc)
          })        
        }
      })
    }
    
    if (t.delay) {
      setTimeout(check, Math.random() * 111)
    } else {
      check()
    }
  })
  
  t.on('tasked.new', function (doc) {
    var task = new Task(doc, function (e) {
      function update (doc) {
        doc.state = 'complete'
        doc.results = task.results
        doc.errors = task.errors
      }

      c.update(doc._id, update, function (e, info) {
        doc._rev = info.rev
        f.emit('complete', doc)
      })
    })
    task.t = t
    t.emit(doc.type, task)
  })
  
  return t
}

module.exports.provision = function provision (url, cb) {
  var view = (function (doc) {
    if (doc.state === 'new') emit(1, 1)
  }).toString()
  couch(url).update('_design/tasked', function (doc) {
    doc.views = {tasks:{map:view}}
  }, cb)
}

