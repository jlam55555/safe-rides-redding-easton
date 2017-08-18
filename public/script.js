$(function() {

  // make web app standalone (i.e., not open links in safari)
  // src: https://gist.github.com/irae/1042167 (condensed version)
  (function(a,b,c){if(c in b&&b[c]){var d,e=a.location,f=/^(a|html)$/i;a.addEventListener("click",function(a){d=a.target;while(!f.test(d.nodeName))d=d.parentNode;"href"in d&&(chref=d.href).replace(e.href,"").indexOf("#")&&(!/^[a-z\+\.\-]+:/i.test(chref)||chref.indexOf(e.protocol+"//"+e.host)===0)&&(a.preventDefault(),e.href=d.href)},!1)}})(document,window.navigator,"standalone");
  if(("standalone" in window.navigator) && window.navigator["standalone"]) {
    $("#header").addClass("webApp");
  }

  // scrolling details
  $("body").on("touchmove", function(event) {
    event.preventDefault();
  });

  // tab details
  var currentTab = 1;
  var user = {signedIn: false};
  var addRemoveHandlerRunning = false;
  for(var i = 0; i < 24; i++) {
    $("#calendarVolunteers").append($("<div/>").html(i%2===1?("0"+i).slice(-2) + ":00":"&#8203;").addClass("volunteerStripes striped"));
  }
  $(".menuButton").click(function() {
    var tabId = $(this).data("tab-id");
    $(".menuButton").removeClass("redbg greenbg bluebg");
    $("#header").removeClass("redbg greenbg bluebg");
    $(".tab").each(function() {
      if($(this).data("tab-id") === tabId) {
        $("#header").text($(this).data("tab-name"));
        $(this).show();
      } else {
        $(this).hide();
      }
    });
    switch($(this).data("tab-id")) {
      case 1:
        checkOnDuty();
        $("#header").addClass("redbg");
        $(".menuButton:nth-of-type(1)").addClass("redbg");
        break;
      case 2:
        $("#header").addClass("greenbg");
        $(".menuButton:nth-of-type(2)").addClass("greenbg");
        break;
      case 3:
        unsetCalendar();
        $("#header").addClass("bluebg");
        $(".menuButton:nth-of-type(3)").addClass("bluebg");
        break;
    }
  });
  $(".menuButton").first().click();
  $(".changeTab").click(function() {
    $(".menuButton:nth-of-type(" + $(this).data("tab-id") + ")").click();
  });

  // check if on duty
  var dateFormat = new Intl.DateTimeFormat("en-us", {year: "2-digit", month: "2-digit", day: "2-digit"});
  setCalendar(dateFormat.format(new Date()));
  function checkOnDuty() {
    if(!user.signedIn) return;
    for(var i = 0; i < calendar[currentDate].length; i++) {
      if(
        calendar[currentDate][i].email === user.email
        && new Date().getHours() >= calendar[currentDate][i].start
        && new Date().getHours() <= calendar[currentDate][i].end
      ) {
        $("#onDuty").text("On duty. Shift ends at " + calendar[currentDate][i].end + ":59.");
        return;
      }
    }
    $("#onDuty").text("Not on duty.");
  }
  setInterval(checkOnDuty, 1000);

  // calendar details
  var calendar;
  var dateIterator = new Date();
  for(var i = 0; i < 30; i++) {
    $("#calendarDays").append(
      $("<div/>")
        .text(dateFormat.format(dateIterator))
        .addClass("calendarDay")
    );
    dateIterator = new Date(dateIterator.valueOf() + 86400000);
  }
  var currentDate;
  var blockSize;
  var isCalendar = false;
  function setCalendar(date) {
    isCalendar = true;
    $("#calendar").height($("#content").height());
    currentDate = date;
    $(".volunteer").remove();
    $.post("./getCalendar", {}, function(data) {
      calendar = data;
      //calendar = {"08/17/17": [{"name":"Jessica Lam","email":"jjssclam@aol.com","start":16,"end":20},{"name":"Jonathan Lam","email":"jlam55555@gmail.com","start":5,"end":10},{"name":"Jessica Lam","email":"jjssclam@aol.com","start":2,"end":14}]};
      $("#calendarDays").hide();
      $("#calendar").show();
      blockSize = $("#calendarVolunteers").height()/24;
      $(".volunteerStripes").css({
        maxHeight: blockSize
      });
      console.log(calendar);
      calendar[date] = calendar[date].sort(function(a, b) {
        if(a.email === user.email) {
          return -1;
        }
        if(b.email === user.email) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });
      var userCounter = -1;
      for(var i = 0; i < calendar[date].length; i++) {
        if(calendar[date][i].start === null) continue;
        if(i === 0 || calendar[date][i].email !== calendar[date][i-1].email) { // fix this
          userCounter++;
        }
        $("#calendarVolunteers").append(
          $("<div/>")
            .addClass("volunteer color" + (userCounter%6))
            .css({
              width: blockSize,
              height: (calendar[date][i].end-calendar[date][i].start+1)*blockSize,
              top: $(".volunteerStripes:nth-of-type(" + (parseInt(calendar[date][i].start)+1) + ")")[0].offsetTop,
              left: (userCounter+1)*blockSize
            })
            .data("name", calendar[date][i].name)
            .data("start", calendar[date][i].start)
            .data("end", calendar[date][i].end)
        );
      }
      addRemoveHandler();
    }, "json");
  };
  $(document).on("mouseenter", ".volunteer", function(event) {
    $("#calendarVolunteers").append(
      $("<div/>")
        .html("<strong>" + $(this).data("name") + "</strong><br>" + ("0"+$(this).data("start")).slice(-2) + ":00-" + ("0"+$(this).data("end")).slice(-2) + ":59")
        .addClass("volunteerInfo")
        .css({
          top: event.pageY - $("#calendarVolunteers")[0].offsetTop + $("#content").scrollTop(),
          left: event.pageX - $("#calendarVolunteers")[0].offsetLeft + parseInt($(this).css("font-size"))
        })
    );
  });
  $(document).on("mouseleave", ".volunteer", function() {
    $(".volunteerInfo").remove();
  });
  function unsetCalendar() {
    $("#calendar").hide();
    $("#calendarDays").show();
    isCalendar = false;
  }
  $("#unsetCalendar").click(unsetCalendar);
  $(".calendarDay").click(function() {
    setCalendar($(this).text());
  });
  function addRemoveHandler() {
    if(!isCalendar || addRemoveHandlerRunning) return;
    addRemoveHandlerRunning = true;
    var startX;
    var startY;
    var selectionElement = $("<div/>").attr("id", "selectionElement");
    $("#calendarVolunteers").append(selectionElement);
    function addTimeMousedownHandler(event) {
      startX = blockSize;
      startY = (event.pageY || event.originalEvent.touches[0].pageY) - $("#calendarVolunteers")[0].offsetTop;
      selectionElement.css({
        top: startY,
        left: startX,
        height: blockSize
      });
      $(document).on("mousemove touchmove", "#calendarVolunteers, #calendarHours", addTimeMousemoveHandler);
      $(document).one("mouseup touchcancel touchend", "#calendarVolunteers, #calendarHours", addTimeMouseupHandler);
    }
    function addTimeMousemoveHandler(event) {
      selectionElement.css({
        top: startY,
        left: startX,
        height: Math.max(blockSize, (event.pageY || event.originalEvent.touches[0].pageY) - $("#calendarVolunteers")[0].offsetTop - startY)
      });
      event.preventDefault();
    }
    function addTimeMouseupHandler(event) {
      var endY = startY + parseInt(selectionElement.css("height"));
      var startIndex, endIndex;
      $(".volunteerStripes").each(function(index, elem) {
        if(Math.abs(elem.offsetTop - startY) <= blockSize/2) {
          startIndex = index;
        }
        if(Math.abs(elem.offsetTop+blockSize - endY) <= blockSize/2) {
          endIndex = index;
        }
      });
      console.log(startIndex, endIndex);
      selectionElement.remove();
      $(document).off("mousemove touchmove", "#calendarVolunteers, #calendarHours", addTimeMousemoveHandler);
      var eventType = prompt("Add or remove time?");
      $.post((eventType === "add") ? "/addTime" : "/removeTime", {start: startIndex, end: endIndex, date: currentDate}, function(data) {
        if(!data.success) {
          var error;
          switch(data.error) {
            case 1:
              error = "Sign in to add volunteer times.";
              break;
            case 2:
              error = "Volunteer times invalid.";
              break;
          }
          console.log(error);
          addRemoveHandlerRunning = false;
          addRemoveHandler();
        } else {
          addRemoveHandlerRunning = false;
          setCalendar(currentDate);
        }
      }, "json");
    }
    $(document).one("mousedown touchstart", "#calendarVolunteers, #calendarHours", addTimeMousedownHandler);
  }

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
    user = {signedIn: true, name: name, email: email, phone: phone};
  }

  $("#signout").click(function() {
    $.post("/signout");
    toggleSignedIn(false);
    user = {signedIn: false};
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
