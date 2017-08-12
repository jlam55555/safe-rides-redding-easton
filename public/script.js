$(function() {
  // tab details
  var currentTab = 1;
  $(".menuButton").click(function() {
    var tabId = $(this).data("tab-id");
    $(".menuButton").removeClass("selected");
    $(".menuButton").each(function() {
      if($(this).data("tab-id") === tabId) {
        $(this).addClass("selected");
      }
    })
    $(".tab").each(function() {
      if($(this).data("tab-id") === tabId) {
        $(this).show();
      } else {
        $(this).hide();
      }
    });
  });
  $(".menuButton").first().click();
  $(".changeTab").click(function() {
    $(".menuButton:nth-of-type(" + $(this).data("tab-id") + ")").click();
  });

  // for use when signing in/out
  var signedInElements = $(".signedIn");
  var signedOutElements = $(".signedOut");
  signedInElements.hide();
  function toggleSignedIn(signedIn) {
    if(signedIn) {
      signedInElements.show();
      signedOutElements.hide();
    } else {
      signedInElements.hide();
      signedOutElements.show();
    }
  }

  function signIn(email, name, phone) {
    toggleSignedIn(true);
    $("#profileName").text(name);
    $("#profileEmail").text(email);
    formattedPhone = (phone.length === 11 ? phone.slice(0, 1) + " " : "") + "(" + phone.slice(-10, -7) + ") " + phone.slice(-7, -4) + " " + phone.slice(-4);
    $("#profilePhone").text(formattedPhone);
  }

  $("#signout").click(function() {
    $.post("/signout");
    toggleSignedIn(false);
    console.log("Signed out successfully");
  });

  // check if signed in or not
  $.post("/getUserDetails", function(data) {
    if(data.email !== false) {
      console.log("Signed in");
      signIn(data.email, data.name, data.phone);
    } else {
      console.log("Signed out");
    }
  }, "json");

  // signup form details
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
        $("#signupError").text("Error: " + error);
      } else {
        signIn(email, name, phone);
      }
    }, "json");
  });

  // sign in form details
  $("#signinSubmit").click(function() {
    var email = $("#signinEmail").val().toLowerCase();
    var password = $("#signinPassword").val();
    $.post("/signin", {
      email: email,
      password: password
    }, function(data) {
      if(!data.success) {
        var error;
        switch(data.error) {
          case 1:
            error = "Email not found.";
            break;
          case 2:
            error = "Password does not match.";
            break;
        }
        console.log("Sign in error: " + error);
        $("#signinError").text("Error: " + error);
      } else {
        signIn(email, data.name, data.phone);
        console.log("Signed in success");
      }
    }, "json");
  });
});
