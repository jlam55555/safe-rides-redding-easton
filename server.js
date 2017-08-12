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
//db.none("CREATE TABLE users (email VARCHAR(254) PRIMARY KEY, name VARCHAR(50), password VARCHAR(64), phone VARCHAR(11))").catch(function(err){console.log(err)});

// other dependencies for password hashing, sessions
var passwordHash = require("password-hash");
var session = require("express-session");
app.use(session({
  secret:"blahblahsecretysecret",
  resave: false,
  saveUninitialized: false
}));

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
app.post("/login", function(req, res) {
  
});
app.get("/signout", function(req, res) {
  // sign out
  req.session.destroy();
  req.redirect("/");
});
app.use("/", express.static("public"));

app.listen(process.env.PORT || 5000, function() {
  console.log("Listening on port " + (process.env.PORT || 5000) + ".");
});
