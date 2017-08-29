// routing dependencies
var express = require("express");
var app = express();
var http = require("http").Server(app);
var bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// database dependencies
var pgp = require("pg-promise")();
var db = pgp(process.env.DATABASE_URL + "?ssl=true");

/*
Database table users structure:
+----------+--------------+
| id       | serial       |
| email    | varchar(254) |
| name     | varchar(50)  |
| password | varchar(64)  |
| phone    | varchar(11)  |
| address  | varchar(100) |
| mission  | integer      |
+----------+--------------+
Database table calendar structure:
+------+------+
| json | text |
+------+------+
Database table missions structure:
+-----------+--------------------------+
| id        | serial                   |
| w0        | timestamp with time zone |
| w1        | timestamp with time zone |
| w2        | timestamp with time zone |
| w3        | timestamp with time zone |
| w4        | timestamp with time zone |
| w5        | timestamp with time zone |
| situation | varchar(500)             |
| comments  | varchar(500)             |
| requester | integer                  |
| rescuer1  | integer                  |
| rescuer2  | integer                  |
+-----------+--------------------------+
promise db.query|none|one|many|any|oneOrNone|manyOrNone(query)
*/
/* reset database (for development purposes only)
CREATE TABLE users (id SERIAL, email VARCHAR(254) PRIMARY KEY, name VARCHAR(50) NOT NULL unique, password VARCHAR(64) NOT NULL, phone VARCHAR(11) NOT NULL unique, address VARCHAR(100) NOT NULL unique, mission INTEGER);
DROP TABLE calendar;CREATE TABLE calendar (json TEXT);INSERT INTO calendar (json) VALUES ('{}');
CREATE TABLE missions (id serial, w0 timestamp with time zone, w1 timestamp with time zone, w2 timestamp with time zone, w3 timestamp with time zone, w4 timestamp with time zone, w5 timestamp with time zone, situation varchar(500), requester integer not null, rescuer1 integer not null, rescuer2 integer not null, comments varchar(500));
*/

// twilio for sending text messages
var twilioSid = process.env.TWILIO_SID;
var twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
var twilio = require("twilio");
var twilioClient = new twilio(twilioSid, twilioAuthToken);
function sendSMS(to, body) {
  twilioClient.messages.create({
    body: body,
    to: "+12035900107", // change in production
    from: process.env.TWILIO_PHONE_NUMBER
  })
    .then(function(message) {
      console.log(message.sid);
    })
    .catch(function(err) {
      console.log("err: " + err);
    });
}

// google maps for directions and distance
var googleMapsClient = require("@google/maps").createClient({
  key: process.env.GOOGLE_MAPS_API_KEY
});

// other dependencies for password hashing, sessions, file-writing
var passwordHash = require("password-hash");
var session = require("express-session");
var appSession = session({
  secret:"blahblahsecretysecret",
  resave: true,
  saveUninitialized: true
});
app.use(appSession);
var fs = require("fs");

// socket.io
var io = require("socket.io")(http);
var sharedsession = require("express-socket.io-session");
io.use(sharedsession(appSession), { autoSave: true });
var sockets = [];
io.on("connection", function(socket) {
  sockets.push(socket);
  socket.init = function() {
    // check for mission
    // mission should be set in data
    // WORKING HERE
    //if(mission)
    //  socket.emit("missionData")
    //else
    //  socket.emit("nomissiondata")
  };
  socket.init();
  socket.reload = function() {
    socket.handshake.session.reload(function(err) {
      err && console.log("error: " + err);
      socket.init();
    });
  };
  socket.on("disconnect", function() {
    sockets.splice(sockets.indexOf(socket), 1);
  });
});

// post requests
app.post("/getUserDetails", function(req, res) {
  var ssn = req.session;
  if(ssn.email !== undefined) {
    db.one("SELECT name, phone, address FROM users WHERE email='" + ssn.email + "'")
      .then(function(data) {

        // CHECK FOR MISSION STATUS

        res.json({
          email: ssn.email,
          phone: data.phone,
          name: data.name,
          address: data.address
        });
      })
      .catch(function(err) {
        console.log("/getUserDetails: " + err);
      });
  } else {
    res.json({email: false});
  }
});
// send reminders about volunteer shifts if necessary (needs to happen every hour)
var volunteers = [];
function checkVolunteers() {
  var date = dateFormat.format(new Date());
  var currentHour = (24+new Date().getHours()-4)%24; // four hour time shift from UTC/GMT to EST
  for(var i = 0; i < calendar[date].length; i++) {
    if(calendar[date][i].start === currentHour) {
      console.log("Sending out reminder to " + calendar[date][i].name + " for volunteer shift from " + calendar[date][i].start + ":00 to " + calendar[date][i].end + ":59.");
      volunteers.push({email: calendar[date][i].email, name: calendar[date][i].name});
      (function(i) {
        db.one("SELECT phone FROM users WHERE email='" + calendar[date][i].email + "'")
          .then(function(data) {
            sendSMS(data.phone, "Safe Rides of Redding and Easton reminder: Your volunteer time from " + calendar[date][i].start + ":00 to " + calendar[date][i].end + ":59 has begun.");
          }).catch(e=>console.log(e));
      })(i);
    }
  }
}
setTimeout(function() {
  setInterval(checkVolunteers, 60*60*1000);
}, (61-(new Date().getMinutes()))*60*1000);
// update calendar if necessary
var calendar;
var dateIterator = new Date();
var dateFormat = new Intl.DateTimeFormat("en-us", {year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "America/New_York"}); 
db.one("SELECT json FROM calendar")
  .then(function(data) {
    calendar = JSON.parse(data.json);
    for(var i = 0; i < 30; i++) {
      if(calendar[dateFormat.format(dateIterator)] === undefined) {
        calendar[dateFormat.format(dateIterator)] = [];
      }
      dateIterator = new Date(dateIterator.valueOf() + 86400000);
    }
    db.none("UPDATE calendar SET json='" + JSON.stringify(calendar) + "'").catch((e)=>console.log(e));
    checkVolunteers();
  })
  .catch(function(err) {
    console.log(err);
  });
app.post("/getCalendar", function(req, res) {
  if(req.session.email === undefined) return;
  res.json(calendar);
});
app.post("/addTime", function(req, res) {
  // error code 1: not logged in
  if(req.session.email === undefined) {
    res.json({success: false, error: 1});
    return;
  }
  var email = req.session.email;
  var date = req.body.date;
  var start = parseInt(req.body.start);
  var end = parseInt(req.body.end);
  // error code 2: invalid data
  if(start > end || start < 0 || end > 23) {
    res.json({success: false, error: 2});
    return;
  }
  for(var i = 0; i < calendar[date].length; i++) {
    if(calendar[date][i].email === email) {
      if(
        (calendar[date][i].start <= start-1 && calendar[date][i].end >= start-1)
        || (calendar[date][i].start <= end+1 && calendar[date][i].end >= end+1)
        || (calendar[date][i].start >= start-1 && calendar[date][i].end <= end+1)
      ) {
        start = Math.min(calendar[date][i].start, start);
        end = Math.max(calendar[date][i].end, end);
        calendar[date].splice(i, 1);
        i--;
      }
    }
  }
  calendar[date].push({name: req.session.name, email: req.session.email, start: start, end: end});
  db.none("UPDATE calendar SET json='" + JSON.stringify(calendar) + "'")
    .catch(function(err) {
      console.log(err);
    });
  res.json({success: true});
});
app.post("/removeTime", function(req, res) {
  // error code 1: not logged in
  if(req.session.email === undefined) {
    res.json({success: false, error: 1});
    return;
  }
  var email = req.session.email;
  var date = req.body.date;
  var start = parseInt(req.body.start);
  var end = parseInt(req.body.end);
  // error code 2: invalid data
  if(start > end || start < 0 || end > 23) {
    res.json({success: false, error: 2});
    return;
  }
  for(var i = 0; i < calendar[date].length; i++) {
    if(calendar[date][i].email === email) {
      // if contained within removed area
      if(calendar[date][i].start >= start && calendar[date][i].end <= end) {
        calendar[date].splice(i, 1);
        i--;
        continue;
      }
      // if greater than removed area
      if(calendar[date][i].start < start && calendar[date][i].end > end) {
        calendar[date].push({name: req.session.name, email: req.session.email, start: end+1, end: calendar[date][i].end});
        calendar[date][i].end = start-1;
        continue;
      }
      // if straddling start or end of removed area
      if(calendar[date][i].start < start && calendar[date][i].end >= start) {
        calendar[date][i].end = start - 1;
      }
      if(calendar[date][i].start <= end && calendar[date][i].end > end) {
        calendar[date][i].start = end + 1;
      }
    }
  }
  db.none("UPDATE calendar SET json='" + JSON.stringify(calendar) + "'")
    .catch(function(err) {
      console.log(err);
    });
  res.json({success: true});
});
// requesting a service
app.post("/request", function(req, res) {
  if(req.session.email === undefined) return;
  if(volunteers.length < 2) volunteers = volunteers.concat([{email: "chrisvass1@gmail.com", name: "Christopher Vassallo"},{email: "jlam55555@gmail.com", name: "Jonathan Lam"}]);
  var query = "SELECT name, email, address FROM users WHERE email='" + req.session.email + "'";
  for(var volunteer of volunteers) {
    query += " OR email='" + volunteer.email + "'";
  }
  db.many(query)
    .then(function(dbData) {
      var start = req.body.startLocation;
      var finishIndex;
      var finish = dbData.filter(function(item, index) {
        if(item.email === req.session.email) {
          finishIndex = index;
          return true;
        }
        return false;
      })[0].address;
      dbData.splice(finishIndex, 1);
      var volunteerAddresses = dbData.map(function(item) {
        return item.address;
      });
      var distanceMatrixParams = {
        origins: volunteerAddresses,
        destinations: volunteerAddresses.concat([start])
      };
      // finding the shortest route
      googleMapsClient.distanceMatrix(distanceMatrixParams, function(err, data) {
        if(err) {
          return console.log(err);
        } else {
          var shortest = {
            distance: 100000,
            firstAddress: "",
            secondAddress: ""
          };
          for(var i = 0; i < data.json.rows.length; i++) {
            for(var j = 0; j < data.json.rows[i].elements.length-1; j++) {
              if(i === j) continue;
              var distance = data.json.rows[i].elements[j].distance.value + data.json.rows[j].elements[volunteerAddresses.length].distance.value;
              if(distance < shortest.distance) {
                shortest = {
                  distance: distance,
                  firstAddress: i,
                  secondAddress: j
                };
              }
            }
          }
          var stops = [
            volunteerAddresses[shortest.firstAddress],
            volunteerAddresses[shortest.secondAddress],
            start,
            finish,
            volunteerAddresses[shortest.firstAddress]
          ];
          var directionsUrl = "https://www.google.com/maps/dir/?api=1&origin=" + stops[0] + "&destination=" + stops[4] + "&waypoints=" + stops.slice(1,-1).join("|");
          var driver1Name = dbData.filter(function(volunteer) {
            return volunteer.address === volunteerAddresses[shortest.firstAddress];
          })[0].name;
          var driver2Name = dbData.filter(function(volunteer) {
            return volunteer.address === volunteerAddresses[shortest.secondAddress];
          })[0].name;
          var driveeName = req.session.name;

          res.json({success: true, directionsUrl: directionsUrl, route: stops, driver1: driver1Name, driver2: driver2Name});
          // setInterval for dev only
          var x = -1;
          var t = setInterval(function() {
            if(x++ === 6) {
              clearInterval(t);
              return;
            }

            // for drivee
            var driveeSocket = sockets.filter(function(socket) {
              return socket.handshake.session.email === req.session.email;
            });
            if(driveeSocket.length !== 0) {
              driveeSocket[0].emit("w" + x);
            }
            
            // for driver 1
            var driver1Socket = sockets.filter(function(socket) {
              console.log(socket.handshake.session.name, driver1Name);
              return socket.handshake.session.name === driver1Name;
            });
            if(driver1Socket.length !== 0) {
              driver1Socket[0].emit("w" + x);
            }

            // for driver 2
            var driver2Socket = sockets.filter(function(socket) {
              console.log(socket.handshake.session.name, driver2Name);
              return socket.handshake.session.name === driver2Name;
            });
            if(driver2Socket.length !== 0) {
              driver2Socket[0].emit("w" + x);
            }
          }, 1000);
        }
      });
    })
    .catch(function(err) {
      console.log(err);
    });
});

// routing
app.post("/signup", function(req, res) {
  // get form fields
  var email = req.body.email;
  var password = req.body.password;
  var name = req.body.name;
  var phone = req.body.phone;
  var address = req.body.address;

  // input validation
  // error code 1: email validation (regex courtesy of http://emailregex.com/)
  if(!/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.exec(email) || email.length > 254) {
    res.json({success: false, error: 1});
    return;
  }
  // error code 2: password validation (too long or short)
  if(password.length < 6 || password.length > 50) {
    res.json({success: false, error: 2});
    return;
  }
  // error code 3: name validation (invalid characters in name)
  if(/[^a-zA-Z\-\' ]/.exec(name)) {
    res.json({success: false, error: 3});
    return;
  }
  // error code 4: name validation (too long or short)
  if(name.length < 5 || name.length > 50) {
    res.json({success: false, error: 4});
    return;
  }
  // error code 5: phone validation (too long or short or non-digits)
  if(phone.length !== 10 && phone.length !== 11 || isNaN(phone)) {
    res.json({success: false, error: 5});
    return;
  }

  googleMapsClient.geocode({address: address}, function(err, data) {
    var hasStreetAddress = data.json.status === "OK" && data.json.results.length > 0 && data.json.results[0].address_components.filter(function(elem) {
      return elem.types.indexOf("street_number") === 0;
    }).length === 1;
    if(hasStreetAddress) {
      address = data.json.results[0].formatted_address;
      // create account
      db.none("INSERT INTO users (email, name, password, phone, address) VALUES ('" + email.toLowerCase() + "', '" + name + "','" + passwordHash.generate(password) + "', '" + phone + "', '" + address + "')")
        .then(function() {
          console.log(name + " signed up under email "  + email + ".");
          // sign in session
          req.session.email = email;
          req.session.name = name;
          res.json({success: true, address: address});
        })
        .catch(function(err) {
          // error code 6: email taken
          res.json({success: false, error: 6});
        });
    } else {
      // error code 7: invalid address
      res.json({success: false, error: 7});
    }
  });
});
app.post("/signin", function(req, res) {
  var email = req.body.email;
  var password = req.body.password;

  db.one("SELECT phone, name, address, password FROM users WHERE email='" + email + "'")
    .then(function(data) {
      if(passwordHash.verify(password, data.password)) {
        req.session.email = email;
        req.session.name = data.name;
        var socket = sockets.filter(function(socket) {
          return socket.handshake.session.id === req.session.id;
        })[0];
        req.session.save(function(err) {
          err && console.log(err);
          socket.reload();
        });
        res.json({success: true, phone: data.phone, name: data.name, address: data.address});
      } else {
        // error code 2: incorrect password
        res.json({success: false, error: 2});
      }
    })
    .catch(function(err) {
      console.log(err);
      // error code 1: email not found
      res.json({success: false, error: 1})
    });
});
app.post("/signout", function(req, res) {
  var socket = sockets.filter(function(socket) {
    return socket.handshake.session.email === req.session.email;
  })[0];
  req.session.regenerate(function(err) {
    err && console.log(err);
    socket.reload();
  });
});
app.use("/", express.static("public"));

http.listen(process.env.PORT || 5000, function() {
  console.log("Listening on port " + (process.env.PORT || 5000) + ".");
});
