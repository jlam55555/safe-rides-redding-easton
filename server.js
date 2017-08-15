// routing dependencies
var express = require("express");
var app = express();
var bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// database dependencies
var pgp = require("pg-promise")();
var db = pgp(process.env.DATABASE_URL);

/*
Database table USERS structure:
+----------+--------------+
| email    | VARCHAR(254) |
| name     | VARCHAR(50)  |
| password | VARCHAR(64)  |
| phone    | VARCHAR(11)  |
+----------+--------------+
promise db.query|none|one|many|any|oneOrNone|manyOrNone(query)
*/
// reset database (for development purposes only)
//db.none("DROP TABLE users").catch((e)=>console.log(e));
//db.none("CREATE TABLE users (email VARCHAR(254) PRIMARY KEY, name VARCHAR(50) NOT NULL, password VARCHAR(64) NOT NULL, phone VARCHAR(11) NOT NULL)").catch(function(err){console.log(err)});
//db.none("DROP TABLE calendar").catch((e)=>console.log(e));
//db.none("CREATE TABLE calendar (json TEXT)").catch((e)=>console.log(e));
//var json = require("./volunteers.json");
//db.none("INSERT INTO calendar (json) VALUES ('" + JSON.stringify(json) + "')").catch((e)=>console.log(e));

// other dependencies for password hashing, sessions, file-writing
var passwordHash = require("password-hash");
var session = require("express-session");
app.use(session({
  secret:"blahblahsecretysecret",
  resave: false,
  saveUninitialized: false
}));
var fs = require("fs");

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

// post requests
app.post("/getUserDetails", function(req, res) {
  var ssn = req.session;
  if(ssn.email !== undefined) {
    db.one("SELECT name, phone FROM users WHERE email='" + ssn.email + "'")
      .then(function(data) {
        res.json({
          email: ssn.email,
          phone: data.phone,
          name: data.name
        });
      })
      .catch(function(err) {
        console.log(err);
      });
  } else {
    res.json({email: false});
  }
});
// update calendar if necessary
var calendar;
var dateIterator = new Date();
var dateFormat = new Intl.DateTimeFormat("en-us", {year: "2-digit", month: "2-digit", day: "2-digit"}); 
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
  })
  .catch(function(err) {
    console.log(err);
  });
app.post("/getCalendar", function(req, res) {
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

// routing
app.post("/signup", function(req, res) {
  // get form fields
  var email = req.body.email;
  var password = req.body.password;
  var name = req.body.name;
  var phone = req.body.phone;

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

  // create account
  db.none("INSERT INTO users (email, name, password, phone) VALUES ('" + email.toLowerCase() + "', '" + name + "','" + passwordHash.generate(password) + "', '" + phone + "')")
    .then(function() {
      console.log(name + " signed up under email "  + email + ".");
      // sign in session
      req.session.email = email;
      res.json({success: true});
    })
    .catch(function(err) {
      // error code 6: email taken
      res.json({success: false, error: 6});
    });
});
app.post("/signin", function(req, res) {
  var email = req.body.email;
  var password = req.body.password;

  db.one("SELECT phone, name, password FROM users WHERE email='" + email + "'")
    .then(function(data) {
      if(passwordHash.verify(password, data.password)) {
        req.session.email = email;
        req.session.name = data.name;
        res.json({success: true, phone: data.phone, name: data.name});
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
  // sign out and return to homepage
  req.session.destroy();
});
app.use("/", express.static("public"));

app.listen(process.env.PORT || 5000, function() {
  console.log("Listening on port " + (process.env.PORT || 5000) + ".");
});
