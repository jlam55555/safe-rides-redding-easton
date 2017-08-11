var express = require("express");
var app = express();

app.use("/", express.static("public"));

var pgp = require("pg-promise")();
var db = pgp(process.env.DATABASE_URL);

db.many("CREATE TABLE users (email VARCHAR(254), name VARCHAR(50), password VARCHAR(128), phone VARCHAR(11))")
  .then(function(data) {
    console.log(data);
  })
  .catch(function(err) {
    console.log(err);
  });

app.listen(process.env.PORT || 5000, function() {
  console.log("Listening on port " + (process.env.PORT || 5000));
});
