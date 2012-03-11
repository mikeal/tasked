var tasked = require('../index')
  , couch = require('couch')
  , dburl = 'http://localhost:5984/testtasked'
  ;

tasked.provision(dburl, function (e) {
  if (e) throw e
  
  var t1 = tasked(dburl)
    , t2 = tasked(dburl)
    , counter = 0
    ;
  
  t1.name = 't1'
  t2.name = 't2'
  t1.delay = true
  t2.delay = true
  
  var ids = {}
  
  var handler = function (task) {
    console.error(task.info._id, task.t.name)
    if (ids[task.info._id]) throw new Error('Called twice for '+task.info._id)
    ids[task.info._id] = true
    
    counter++
    if (counter === 100) {
      console.log('All tests passed.')
      process.exit()
    }
  }
  
  t1.on('test', handler)
  t2.on('test', handler)
  
  var i = 0
  while (i < 100) {
    couch(dburl).post({type:'test', state:'new'}, function (e, i) {
      if (e) throw e
      console.log('created '+i.id)
    })
    i++
  }
  
})

