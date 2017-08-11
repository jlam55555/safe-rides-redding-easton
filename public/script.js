$(function() {
  $("#signupSubmit").click(function() {
    var email = $("#signupEmail").val();
    var password = $("#signupPassword").val();
    var name = $("#signupName").val();
    var phone = $("#signupPhone").val();
    $.post("/signup", {
      email: email,
      password: password,
      name: name,
      phone: phone
    }, function(data) {
      console.log(data);
    });
  });
});
