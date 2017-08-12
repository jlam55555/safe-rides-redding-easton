$(function() {
  $.post("/getUserDetails", function(data) {
    if(data.email !== false) {
      console.log("Signed in");
    } else {
      console.log("Signed out");
    }
  }, "json")

  $("#signupSubmit").click(function() {
    var email = $("#signupEmail").val().toLowerCase();
    var password = $("#signupPassword").val();
    var name = $("#signupName").val();
    var phone = $("#signupPhone").val().replace(/[^0-9]/g, "");
    $.post("/signup", {
      email: email,
      password: password,
      name: name,
      phone: phone
    }, function(data) {
      if(!data.success) {
        var error;
        switch(data.error) {
          case 1:
            error = "Provided email is not a valid email address.";
            break;
          case 2:
            error = "Password must be between 6 and 50 characters.";
            break;
          case 3:
            error = "Name can only include letters, spaces, apostrophes, or dashes.";
            break;
          case 4:
            error = "Name must be between 5 and 50 characters.";
            break;
          case 5:
            error = "Phone number must be be 10 or 11 digits.";
            break;
          case 6:
            error = "Email address is already in use.";
            break;
        }
        console.log("Sign up error: " + error);
      } else alert("Sign up success");
    }, "json");
  });
});
