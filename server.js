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
// safestring everything!
var safestring = function(input) {
  return input.toString().replace(/[\0\'\"\b\n\r\t\Z\\\%\_\x08\x09\x1a]/g, "");
};

/*
Database table users structure:
+------------+-----------------------+
| id         | serial                |
| email      | varchar(254)          |
| name       | varchar(50)           |
| password   | varchar(64)           |
| phone      | varchar(11)           |
| address    | varchar(100)          |
| mission    | integer               |
| authorized | boolean default false |
+------------+-----------------------+
Database table calendar structure:
+------+------+
| json | text |
+------+------+
Database table missions structure:
+--------------+--------------------------+
| id           | serial                   |
| w0           | timestamp with time zone |
| w1           | timestamp with time zone |
| w2           | timestamp with time zone |
| w3           | timestamp with time zone |
| startplace   | varchar(200)             |
| endplace     | varchar(200)             |
| meetingplace | varchar(200)             |
| situation    | varchar(500)             |
| comments     | varchar(500)             |
| url          | varchar(500)             |
| drivee       | integer                  |
| driver1      | integer                  |
| driver2      | integer                  |
+--------------+--------------------------+
promise db.query|none|one|many|any|oneOrNone|manyOrNone(query)
*/
/* reset database (for development purposes only)
CREATE TABLE users (id SERIAL, email VARCHAR(254) PRIMARY KEY, name VARCHAR(50) NOT NULL unique, password VARCHAR(64) NOT NULL, phone VARCHAR(11) NOT NULL unique, address VARCHAR(100) NOT NULL, mission INTEGER, authorized BOOLEAN DEFAULT FALSE);
DROP TABLE calendar;CREATE TABLE calendar (json TEXT);INSERT INTO calendar (json) VALUES ('{}');
CREATE TABLE missions (id serial, w0 timestamp with time zone, w1 timestamp with time zone, w2 timestamp with time zone, w3 timestamp with time zone, startPlace varchar(200), endPlace varchar(200), meetingPlace varchar(200), situation varchar(500), url varchar(500) NOT NULL, drivee integer not null, driver1 integer not null, driver2 integer not null, comments varchar(500));
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
  secret: process.env.SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 30*24*60*60*1000
    //secure: true
  }
});
app.use(appSession);
var fs = require("fs");

// convenience functions
function getUserId(name, fn) {
  db.one("SELECT id FROM users WHERE name='" + safestring(name) + "'")
    .then(data => fn.call(null, data.id))
    .catch(e => console.log("get id error: " + e));
}
function getUserName(id, fn) {
  db.one("SELECT name FROM users WHERE id=" + safestring(id))
    .then(data => fn.call(null, data.name))
    .catch(e => console.log("get name error: " + e));
}

// socket.io
var io = require("socket.io")(http);
var sharedsession = require("express-socket.io-session");
io.use(sharedsession(appSession), { autoSave: true });
var sockets = [];
io.on("connection", function(socket) {
  sockets.push(socket);
  socket.sendMissionData = function() {
    if(!socket.handshake.session.email) return socket.emit("noMissionData");
    db.one("SELECT mission FROM users WHERE email='" + safestring(socket.handshake.session.email) + "'")
      .then(function(data) {
        if(data.mission === null) {
          socket.emit("noMissionData");
        } else {
          db.one("SELECT * FROM missions WHERE id=" + safestring(data.mission)) 
            .then(function(data) {
              getUserName(data.driver1, function(driver1Name) {
                getUserName(data.driver2, function(driver2Name) {
                  getUserName(data.drivee, function(driveeName) {
                      var role = 0; // default role drivee
                      if(socket.handshake.session.name === driver1Name) {
                        role = 1;
                      } else if(socket.handshake.session.name === driver2Name) {
                        role = 2;
                      }
                      socket.emit("missionData", {
                        id: data.id,
                        waypoints: [
                          data.w0,
                          data.w1,
                          data.w2,
                          data.w3
                        ],
                        directionsUrl: data.url,
                        driver1: driver1Name,
                        driver2: driver2Name,
                        drivee: driveeName,
                        role: role,
                        start: data.startplace,
                        end: data.endplace,
                        meeting: data.meetingplace
                      });
                    });
                  });
                });
              })
              .catch(e=>console.log("sendMissionData error: " + e));
        }
      })
      .catch(e=>console.log(e));
  };
  socket.on("confirm", function(waypoint) {
    if(!socket.handshake.session.email) return;
    db.one("SELECT mission FROM users WHERE email='" + safestring(socket.handshake.session.email) + "'")
      .then(function(data) {
        if(data.mission === null) {
          console.log("no mission");
          return;
        }
        var mission = data.mission;
        db.one("SELECT * FROM missions WHERE id=" + safestring(mission))
          .then(function(data) {
            var waypoints = [data.w0, data.w1, data.w2, data.w3];
            var nextWaypoint = false;
            for(var i = 0; i < waypoints.length; i++) {
              if(waypoints[i] === null) {
                nextWaypoint = i;
                break;
              }
            }
            if(nextWaypoint === false || nextWaypoint !== waypoint) {
              console.log("mission completed or wrong waypoint");
              return;
            }
            getUserId(socket.handshake.session.name, function(userId) {
              if(
                (userId === data.drivee && (waypoint == 1 || waypoint == 2))
                || ((userId === data.driver1 || userId === data.driver2) && (waypoint == 0 || waypoint == 3))
              ) {
                db.none("UPDATE missions SET w" + safestring(waypoint) + "=current_timestamp WHERE id=" + safestring(mission))
                  .then(function() {
                    var missionSockets = sockets.filter(function(socket) {
                      return socket.handshake.session.uid === data.drivee
                          || socket.handshake.session.uid === data.driver1
                          || socket.handshake.session.uid === data.driver2;
                    });
                    if(waypoint === 3) {
                      db.none("UPDATE users SET mission=null WHERE id=" + safestring(data.drivee) + " OR id=" + safestring(data.driver1) + " OR id=" + safestring(data.driver2))
                        .then(function() {
                          for(var socket of missionSockets) {
                            socket.sendMissionData();
                          }
                        })
                        .catch(e=>console.log(e));
                    } else {
                      for(var socket of missionSockets) {
                        socket.sendMissionData();
                      }
                    }
                  })
                  .catch(e=>console.log(e));
              } else {
                console.log("you are not the right role to confirm this");
                return;
              }
            });
          })
          .catch(e=>console.log(e));
      })
      .catch(e=>console.log(e));
  });
  socket.reload = function() {
    socket.handshake.session.reload(function(e) {
      e && console.log("socket session reload error: " + e);
      socket.sendMissionData();
    });
  };
  socket.on("disconnect", function() {
    sockets.splice(sockets.indexOf(socket), 1);
  });
});

// post requests
app.post("/getUserDetails", function(req, res) {
  if(req.session.email !== undefined) {
    var socket = sockets.filter(function(socket) {
      return socket.handshake.session.email === req.session.email;
    })[0]
    socket.sendMissionData();
    db.one("SELECT name, phone, address FROM users WHERE email='" + safestring(req.session.email) + "'")
      .then(function(data) {
        res.json({
          email: req.session.email,
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
        db.one("SELECT phone FROM users WHERE email='" + safestring(calendar[date][i].email) + "'")
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
  // error code 3: not authorized to volunteer
  db.one("SELECT authorized FROM users WHERE email='" + safestring(req.session.email) + "'")
    .then(function(data) {
      if(data.authorized === false) {
        res.json({success: false, error: 3});
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
    })
    .catch(function(e) { console.log("Error: cannot check authorization for addTime") });
    
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
  var query = "SELECT name, email, address, mission, authorized FROM users WHERE email='" + req.session.email + "'";

  // just for testing
  if(volunteers.length < 2) volunteers = volunteers.concat([{email: "chrisvass1@gmail.com", name: "Christopher Vassallo"},{email: "jlam55555@gmail.com", name: "Jonathan Lam"}]);
  //volunteers = [{email: "chrisvass1@gmail.com", name: "Christopher Vassallo"}];

  for(var volunteer of volunteers) {
    query += " OR email='" + volunteer.email + "'";
  }
  db.many(query)
    .then(function(dbData) {
      // choosing volunteers
      var eligibleVolunteers = [];
      for(var volunteer of dbData) {
        // only allow volunteers if not requester, not already on a mission, and authorized
        if(
          volunteer.email !== req.session.email
          && volunteer.mission === null
          && volunteer.authorized === true
        ) {
          eligibleVolunteers.push(volunteer);
        }
      }
      if(eligibleVolunteers.length < 2) {
        console.log("Error: Fewer than two available volunteers");
        // send out text message for help
        return;
      }
      // randomly choose two of the volunteers
      var firstVolunteerId = Math.floor(Math.random() * eligibleVolunteers.length);
      var secondVolunteerId;
      while((secondVolunteerId = Math.floor(Math.random() * eligibleVolunteers.length)) === firstVolunteerId) {}
      var pickedVolunteers = [eligibleVolunteers[firstVolunteerId], eligibleVolunteers[secondVolunteerId]];
      

      // getting locations and creating request
      var start = req.body.startLocation;
      var finishIndex;
      var finish = dbData.filter(function(item, index) {
        if(item.email === req.session.email) {
          finishIndex = index;
          return true;
        }
        return false;
      })[0].address;
          var stops = [
            process.env.MEETING_PLACE,
            start,
            finish,
            process.env.MEETING_PLACE
          ];
          var directionsUrl = "https://www.google.com/maps/dir/?api=1&origin=" + stops[0] + "&destination=" + stops[3] + "&waypoints=" + stops.slice(1,-1).join("|");
          var driver1Name = pickedVolunteers[0].name;
          var driver2Name = pickedVolunteers[1].name;
          var driveeName = req.session.name;

          res.json({success: true});

          getUserId(driver1Name, function(driver1Id) {
            getUserId(driver2Name, function(driver2Id) {
              getUserId(req.session.name, function(driveeId) {
                // update user mission field
                db.one("INSERT INTO missions (situation, url, driver1, driver2, drivee, startplace, endplace, meetingplace) VALUES ('" + safestring(req.body.situation) + "', '" + safestring(directionsUrl) + "', " + safestring(driver1Id) + ", " + safestring(driver2Id) + ", " + safestring(driveeId) + ", '" + safestring(start) + "', '" + safestring(finish) + "', '" + safestring(process.env.MEETING_PLACE) + "') RETURNING id")
                  .then(function(data) {
                    db.none("UPDATE users SET mission=" + data.id + " WHERE id=" + driver1Id + " OR id=" + driver2Id + " OR id=" + driveeId)
                      .then(function() {
                        var socket = sockets.filter(function(socket) {
                          return socket.handshake.session.email === req.session.email;
                        })[0];
                        socket.sendMissionData();
                      })
                      .catch(e=>console.log(e));
                  })
                  .catch(e=>console.log(e));
              });
            });
          });
    })
    .catch(function(err) {
      console.log(err);
    });
});

// routing
app.post("/signup", function(req, res) {
  // get form fields
  var email = safestring(req.body.email);
  var password = req.body.password;
  var name = safestring(req.body.name);
  var phone = safestring(req.body.phone);
  var address = safestring(req.body.address);

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
  if(phone.length !== 11 || isNaN(phone)) {
    res.json({success: false, error: 5});
    return;
  }

  googleMapsClient.geocode({address: address}, function(err, data) {
    var hasStreetAddress = data.json.status === "OK" && data.json.results.length > 0 && data.json.results[0].address_components.filter(function(elem) {
      return elem.types.indexOf("street_number") === 0;
    }).length === 1;
    if(hasStreetAddress) {
      address = data.json.results[0].formatted_address;
      // check if account details already exist
      // address can be the same for siblings
      db.oneOrNone("SELECT email, name, phone FROM users WHERE email='" + email.toLowerCase() + "' OR name='" + name + "' OR phone='" + phone + "' LIMIT 1")
        .then(function(data) {
          if(data === null) {
            // create account
            db.one("INSERT INTO users (email, name, password, phone, address) VALUES ('" + email.toLowerCase() + "', '" + name + "','" + passwordHash.generate(password) + "', '" + phone + "', '" + address + "') RETURNING id")
              .then(function(data) {
                console.log(name + " signed up under email "  + email + ".");
                // sign in session
                req.session.email = email;
                req.session.name = name;
                req.session.uid = data.id;
                res.json({success: true, address: address});
                var socket = sockets.filter(function(socket) {
                  return socket.handshake.session.id === req.session.id;
                })[0];
                req.session.save(function(err) {
                  err && console.log(err);
                  socket.reload();
                });
              })
              .catch(function(e) {
                console.log("Error creating user", e);
              });
          } else {
            // error code 6: email taken
            if(data.email === email.toLowerCase()) {
              res.json({success: false, error: 6});
              return;
            }
            // error code 7: name taken
            if(data.name === name) {
              res.json({success: false, error: 7});
              return;
            }
            // error code 8: phone taken
            if(data.phone === phone) {
              res.json({success: false, error: 8});
              return;
            }
          }
        })
        .catch(function(e) {
          console.log("Error with checking for duplicates", e);
        });
    } else {
      // error code 9: invalid address
      res.json({success: false, error: 9});
    }
  });
});
app.post("/signin", function(req, res) {
  var email = safestring(req.body.email);
  var password = req.body.password;

  db.oneOrNone("SELECT id, phone, name, address, mission, password FROM users WHERE email='" + safestring(email) + "'")
    .then(function(data) {
      if(data === null) {
        res.json({success: false, error: 1});
        return;
      }
      if(passwordHash.verify(password, data.password)) {
        req.session.email = email;
        req.session.name = data.name;
        req.session.uid = data.id;
        var socket = sockets.filter(function(socket) {
          return socket.handshake.session.id === req.session.id;
        })[0];
        if(socket === undefined) {
          console.log("error: socket is undefined");
          // error code 3: server restart error
          res.json({success: false, error: 3});
          return;
        }
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
      console.log("signin error: " + err);
      // error code 1: email not found
      res.json({success: false, error: 1})
    });
});
app.post("/signout", function(req, res) {
  var socket = sockets.filter(function(socket) {
    return socket.handshake.session.email === req.session.email;
  })[0];
  req.session.email = undefined;
  req.session.name = undefined;
  req.session.uid = undefined;
  req.session.save(function(e) {
    e && console.log("sign out error: " + e);
    socket.reload();
  });
});
app.use("/", express.static("public"));

http.listen(process.env.PORT || 5000, function() {
  console.log("Listening on port " + (process.env.PORT || 5000) + ".");
});
