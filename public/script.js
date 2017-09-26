var map;
var markers = [];
var bounds;
var createMarker = function(address) {
  var geocoder = new google.maps.Geocoder();
  geocoder.geocode({address: address}, function(results, status) {
    var marker = new google.maps.Marker({
      position: results[0].geometry.location,
      map: map,
      title: address
    });
    markers.push(marker);
    bounds.extend(marker.getPosition());
    map.fitBounds(bounds);
    map.setCenter(bounds.getCenter());
    google.maps.event.trigger(map, "resize");
  });
}
var createMarkers = function(addresses) {
  markers = [];
  bounds = new google.maps.LatLngBounds();
  for(var address of addresses) {
    createMarker(address);
  }
};
var initMap = function() {
  map = new google.maps.Map(document.getElementById("requestMap"), {
    mapTypeId: google.maps.MapTypeId.ROADMAP
  });
};
$(function() {
  // make web app standalone (i.e., not open links in safari)
  // src: https://gist.github.com/irae/1042167 (condensed version)
  (function(a,b,c){if(c in b&&b[c]){var d,e=a.location,f=/^(a|html)$/i;a.addEventListener("click",function(a){d=a.target;while(!f.test(d.nodeName))d=d.parentNode;"href"in d&&(chref=d.href).replace(e.href,"").indexOf("#")&&(!/^[a-z\+\.\-]+:/i.test(chref)||chref.indexOf(e.protocol+"//"+e.host)===0)&&(a.preventDefault(),e.href=d.href)},!1)}})(document,window.navigator,"standalone");
  if(("standalone" in window.navigator) && window.navigator["standalone"]) {
    $("#header").addClass("webApp");
  }

  // detecting swipes
  // src: http://www.javascriptkit.com/javatutors/touchevents2.shtml
  function swipedetect(e,t){var n,a,u,c,i,o,d,h=e,s=t||function(e){};h.addEventListener("touchstart",function(e){var t=e.changedTouches[0];n="none",dist=0,a=t.pageX,u=t.pageY,d=(new Date).getTime()/*,e.preventDefault()*/},!1),h.addEventListener("touchmove",function(e){/*e.preventDefault()*/},!1),h.addEventListener("touchend",function(e){var t=e.changedTouches[0];c=t.pageX-a,i=t.pageY-u,(o=(new Date).getTime()-d)<=300&&(Math.abs(c)>=150&&Math.abs(i)<=100?n=c<0?"left":"right":Math.abs(i)>=150&&Math.abs(c)<=100&&(n=i<0?"up":"down")),s(n)/*,e.preventDefault()*/},!1)}

  // modal script
  var Modal = function(text, options) {
    var elem = $("<div/>")
      .addClass("modal")
      .text(text);
    var buttons = $("<div/>")
      .addClass("modalButtons");
    for(var option of options) {
      (function(option) {
        buttons.append($("<button/>")
          .text(option.option)
          .addClass("modalButton")
          .click(function() {
            option.handler();
            elem.remove();
          }));
        })(option);
    }
    elem.append(buttons);
    $("body").append(elem);
  };

  // socket.io
  var socket = io();

  // general button pressing
  $(document).on("keyup", "textarea, input", function(event) {
    event.which === 13 && $(this).nextAll().filter("button").first().click();
  });
  function resetInputs() {
    $("input, textarea").val("");
  }
  function changeTabShortcutHandler(event, direction) {
    if(direction !== undefined || ((event.which === 37 || event.which === 39) && !$(event.target).is("input, textarea"))) {
      var currentTab = 1;
      $(".menuButton").each(function(index) {
        $(this).is(".redbg, .greenbg, .bluebg") && (currentTab = index);
      });
      var mod = (n, m) => ((n % m) + m) %m; // for negative numbers
      (direction === false || event.which === 37) && $(".menuButton:nth-child(" + (mod(currentTab-1,3)+2) + ")").click();
      (direction === true || event.which === 39) && $(".menuButton:nth-child(" + ((currentTab+1)%3+2) + ")").click();
    }
  }
  $(document).on("keyup", changeTabShortcutHandler);
  swipedetect($("#content")[0], function(direction) {
    if(direction === "left") {
      changeTabShortcutHandler({}, false);
    } else if(direction === "right") {
      changeTabShortcutHandler({}, true);
    }
  });

  // tab details
  var currentTab = 1;
  var user = {signedIn: false};
  var addRemoveHandlerRunning = false;
  for(var i = 0; i < 24; i++) {
    $("#calendarVolunteers").append($("<div/>").html(i%2===1?("0"+i).slice(-2) + ":00":"&#8203;").addClass("volunteerStripes striped white4"));
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
        $(".menuButton:nth-of-type(2)").addClass("redbg");
        history.pushState({}, null, "/?tab=1");
        break;
      case 2:
        $("#header").addClass("greenbg");
        $(".menuButton:nth-of-type(3)").addClass("greenbg");
        setTimeout(function() {
          map.fitBounds(bounds);
          map.setCenter(bounds.getCenter());
          google.maps.event.trigger(map, "resize");
        }, 500);
        history.pushState({}, null, "/?tab=2");
        break;
      case 3:
        unsetCalendar();
        $("#header").addClass("bluebg");
        $(".menuButton:nth-of-type(4)").addClass("bluebg");
        history.pushState({}, null, "/?tab=3");
        break;
    }
  });
  $(".changeTab").click(function() {
    $(".menuButton:nth-of-type(" + (parseInt($(this).data("tab-id"))+1) + ")").click();
    resetInputs();
  });
  var match;
  if((match = window.location.href.match(/\?tab\=([123])$/)) !== null) {
    $(".menuButton:nth-of-type(" + (parseInt(match[1])+1) + ")").click();
    if(match[1] === "4")
      setTimeout(unsetCalendar, 500); // fix this
  } else {
    $(".menuButton:nth-of-type(2)").click();
  }

  $(window).resize(function() { 
    $(".tab, .signedIn, .signedOut, #calendar, #requestContainer").height($("#content").height());
    $("#calendarVolunteers").outerHeight($("#content").height() - $("#unsetCalendar").height());
    setCalendar(currentDate);
  }).resize();

  // profile tab details
  $("#signupContainer").hide();
  $("#toSignup").click(function() {
    $("#signupContainer").show();
    $("#signinContainer").hide();
  });
  $("#toSignin").click(function() {
    $("#signinContainer").show();
    $("#signupContainer").hide();
  });

  // request ride tab details
  $("#requestButton").click(function() {
    var startLocation = $("#startLocation").val().trim();
    var situation = $("#situation").val();
    $.post("/request", {startLocation: startLocation, situation: situation}, ()=>{}, "json");
  });
  socket.on("noMissionData", function() {
    $("#mission").hide();
    $("#requesting").show();
  });
  var timeFormat = new Intl.DateTimeFormat("en-US", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
  socket.on("missionData", function(data) {
    createMarkers([data.start, data.end, data.meeting]);
    $("#situationText").text("Note from ride requester: " + data.situation);
    $(".driver1").text(data.driver1.replace(/ .*$/g, ""));
    $(".driver2").text(data.driver2.replace(/ .*$/g, ""));
    $(".drivee").text(data.drivee.replace(/ .*/g, ""));
    $("#directionsUrl").attr("href", data.directionsUrl);
    $("#requesting").hide();
    $("#mission").show();
    var first = true;
    var confirmId = false;
    $("#mission > p > i").removeClass("fa-ellipsis-h fa-check fa-spin fa-spinner").addClass("fa-ellipsis-h");
    for(var i = 0; i < data.waypoints.length; i++) {
      if(data.waypoints[i] === null) {
        var waypointAddress;
        if(i == 1) waypointAddress = data.start;
        else if(i == 2) waypointAddress = data.end;
        else waypointAddress = data.meeting;
        $("#mission > p:nth-child(" + (i+1) + ") .timestamp").text(waypointAddress);
        if(first) {
          if(
            (data.role === 0 && (i == 1 || i == 2))
            || ((data.role === 1 || data.role === 2) && (i == 0 || i == 3))
          ) {
            confirmId = i+1;
          }
          first = false;
          $("#mission > p:nth-child(" + (i+1) + ") > i").removeClass("fa-ellipsis-h").addClass("fa-spinner fa-spin");
        }
      } else {
        $("#mission > p:nth-child(" + (i+1) + ") > i").removeClass("fa-ellipsis-h fa-spinner fa-spin").addClass("fa-check");
        $("#mission > p:nth-child(" + (i+1) + ") .timestamp").text(timeFormat.format(new Date(data.waypoints[i])));
      }
    }
    $("#mission > p > span").removeClass("confirm");
    confirmId && $("#mission > p:nth-child(" + confirmId + ") > span").addClass("confirm");
  });
  $(".confirmButton").click(function() {
    socket.emit("confirm", $(this).data("confirm"));
  });

  // check if on duty
  var dateFormat = new Intl.DateTimeFormat("en-us", {year: "2-digit", month: "2-digit", day: "2-digit"});
  setCalendar(dateFormat.format(new Date()));
  function checkOnDuty() {
    if(!user.signedIn || !calendar) return;
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

  // calendar details
  var calendar;
  var dateIterator = new Date();
  var shortDateFormat = new Intl.DateTimeFormat("en-us", {day: "2-digit"});
  var monthDateFormat = new Intl.DateTimeFormat("en-us", {month: "long"});
  $("#calendarDays").append($("<div/>").addClass("calendarDay monthName").text(monthDateFormat.format(dateIterator)));
  for(var i = 0; i < dateIterator.getDay(); i++) {
    $("#calendarDays").append(
      $("<div/>").addClass("calendarDay noDate")
    );
  }
  for(var i = 0; i < 30; i++) {
    if(dateIterator.getDate() === 1 && dateIterator.getMonth() !== new Date().getMonth()) {
      for(var j = 0; j < 7-dateIterator.getDay(); j++) {
        $("#calendarDays").append( $("<div/>").addClass("calendarDay noDate"));
      }
      $("#calendarDays").append($("<div/>").addClass("calendarDay monthName").text(monthDateFormat.format(dateIterator)));
      for(var j = 0; j < dateIterator.getDay(); j++) {
        $("#calendarDays").append( $("<div/>").addClass("calendarDay noDate"));
      }
    }
    $("#calendarDays").append(
      $("<div/>")
        .text(shortDateFormat.format(dateIterator))
        .addClass("calendarDay")
        .data("date", dateFormat.format(dateIterator))
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
    $(".volunteer, .volunteerName").remove();
    $("#unsetCalendar").text(date);
    $.post("./getCalendar", {}, function(data) {
      calendar = data;
      $("#calendarDays").hide();
      $("#calendar").show();
      blockSize = $("#calendarVolunteers").height()/24;
      $(".volunteerStripes").css({
        maxHeight: blockSize
      });
      calendar[date] = calendar[date].sort(function(a, b) {
        if(a.email === user.email) {
          return -1;
        }
        if(b.email === user.email) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });
      if(!user.email) return;
      if(calendar[date].length === 0 || calendar[date][0].email !== user.email) {
        calendar[date].unshift({name:user.name, email: user.email, start: -1, end: -1});
      }
      var userCounter = -1;
      for(var i = 0; i < calendar[date].length; i++) {
        if(i === 0 || calendar[date][i].email !== calendar[date][i-1].email) {
          userCounter++;
          $("#calendarVolunteers").append(
            $("<div/>")
              .addClass("volunteerName")
              .text((calendar[date][i].email === user.email ? "You" : calendar[date][i].name) + (calendar[date][i].start === -1 ? " (empty)" : ""))
              .css({
                left: userCounter === 0 ? 8.25*blockSize : 6.75*blockSize+(userCounter+1)*blockSize*2
              })
          );
        }
        $("#calendarVolunteers").append(
          $("<div/>")
            .addClass("volunteer color" + (userCounter%6))
            .css({
              width: blockSize * (userCounter === 0 ? 5 : 1),
              height: calendar[date][i].start !== -1 ? (calendar[date][i].end-calendar[date][i].start+1)*blockSize : 0,
              top: calendar[date][i].start !== -1 ? $(".volunteerStripes:nth-of-type(" + (parseInt(calendar[date][i].start)+1) + ")")[0].offsetTop : 0,
              left: userCounter === 0 ? 3*blockSize : 7.5*blockSize+userCounter*blockSize*2
            })
            .data("name", calendar[date][i].name)
            .data("start", calendar[date][i].start)
            .data("end", calendar[date][i].end)
        );
      }
      addRemoveHandler();
    }, "json");
  };
  function volunteerInfo(element, pageX, pageY) {
    $(".volunteerInfo").remove();
    if(element === null) return;
    $("#calendarVolunteers").append(
      $("<div/>")
        .html("<strong>" + element.data("name") + "</strong><br>" + ("0"+element.data("start")).slice(-2) + ":00-" + ("0"+element.data("end")).slice(-2) + ":59")
        .addClass("volunteerInfo")
        .css({
          top: pageY - $("#calendarVolunteers")[0].offsetTop + $("#content").scrollTop(),
          left: pageX - $("#calendarVolunteers")[0].offsetLeft + parseInt(element.css("font-size"))
        })
    );
  }
  $(document).on("mouseleave", ".volunteer", function() {
    $(".volunteerInfo").remove();
  });
  function unsetCalendar() {
    $("#calendar").hide();
    $("#calendarDays").show();
    isCalendar = false;
  }
  $("#unsetCalendar").click(unsetCalendar);
  $(".calendarDay:not(.noDate):not(.monthName)").click(function() {
    setCalendar($(this).data("date"));
  });
  function addRemoveHandler() {
    if(!isCalendar || addRemoveHandlerRunning) return;
    addRemoveHandlerRunning = true;
    var startX;
    var startY;
    var selectionElement = $("<div/>")
      .attr("id", "selectionElement")
      .addClass("volunteer color0")
      .css({
        width: 5*blockSize,
        left: 3*blockSize,
        height: 0
      });
    $("#calendarVolunteers").append(selectionElement);
    var lastY;
    var targetElement;
    function addTimeMousedownHandler(event) {
      $(document).off("mousedown touchstart", "#calendarVolunteers, #calendarHours", addTimeMousedownHandler);
      targetElement = event.target;
      startY = (event.pageY || event.originalEvent.touches[0].pageY) - $("#calendarVolunteers")[0].offsetTop;
      lastY = startY;
      selectionElement.css({
        top: startY,
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
      lastY = (event.pageY || event.originalEvent.touches[0].pageY);
      event.preventDefault();
    }
    function addTimeMouseupHandler(event) {
      $(document).off("mouseup touchcancel touchend", "#calendarVolunteers, #calendarHours", addTimeMouseupHandler);
      if(startY === lastY && $(targetElement).is(".volunteer:not(#selectionElement)")) {
        selectionElement.remove();
        volunteerInfo($(targetElement), event.pageX, event.pageY);
        $(document).off("mousemove touchmove", "#calendarVolunteers, #calendarHours", addTimeMousemoveHandler);
        addRemoveHandlerRunning = false;
        addRemoveHandler();
        return;
      } else {
        volunteerInfo(null);
      }
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
      // allow backwards dragging later too
      if(startIndex === undefined) {
        startIndex = 0; // make this more dynamic later
      }
      if(endIndex === undefined) {
        endIndex = 23; // make this more dynamic later; this accounts for people dragging off of the screen
      }
      selectionElement.remove();
      $(document).off("mousemove touchmove", "#calendarVolunteers, #calendarHours", addTimeMousemoveHandler);
      function addRemoveTime(eventType) {
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
              case 3:
                error = "Need to be authorized to volunteer. Contact Mike Klein Wassink or Jonathan Lam to be authorized as a volunteer.";
                break;
            }
            new Modal("Error: " + error, [{option: "Okay", handler: ()=>{}}]);
            addRemoveHandlerRunning = false;
            addRemoveHandler();
            checkOnDuty();
          } else {
            addRemoveHandlerRunning = false;
            setCalendar(currentDate);
          }
        }, "json");
      }
      new Modal("Add or remove selected hours for volunteering?", [
        {option: "Add", handler: addRemoveTime.bind(null, "add")},
        {option: "Remove", handler: addRemoveTime.bind(null, "remove")},
        {option: "Cancel", handler: ()=>{
          addRemoveHandlerRunning = false;
          addRemoveHandler();
        }}
      ]);
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

  function signIn(email, name, phone, address) {
    toggleSignedIn(true);
    $("#profileName").text(name);
    $("#profileEmail").text(email);
    formattedPhone = "+" + phone.slice(0, 1) + " (" + phone.slice(-10, -7) + ") " + phone.slice(-7, -4) + " " + phone.slice(-4);
    $("#profilePhone").text(formattedPhone);
    $("#profileAddress").text(address);
    user = {signedIn: true, name: name, email: email, phone: phone, address: address};
    checkOnDuty();
    resetInputs();
  }

  $("#signout").click(function() {
    $.post("/signout");
    toggleSignedIn(false);
    user = {signedIn: false};
    resetInputs();
  });

  // check if signed in or not
  $.post("/getUserDetails", function(data) {
    if(data.email !== false) {
      signIn(data.email, data.name, data.phone, data.address);
    }
  }, "json");

  // signup form details
  $("#signupSubmit").click(function() {
    var email = $("#signupEmail").val().toLowerCase();
    var password = $("#signupPassword").val();
    var name = $("#signupName").val();
    var phone = $("#signupPhone").val().replace(/[^0-9]/g, "");
    if(phone.length === 10) {
      phone = "1" + phone;
    }
    var address = $("#signupAddress").val().trim();
    $.post("/signup", {
      email: email,
      password: password,
      name: name,
      phone: phone,
      address: address
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
          case 7:
            error = "Name already in use.";
            break;
          case 8:
            error = "Phone number already in use.";
            break;
          case 9:
            error = "Address is not valid.";
            break;
        }
        //console.log("Sign up error: " + error);
        //$("#signupError").text("Error: " + error);
        new Modal(error, [{option: "Okay", handler: ()=>{}}]);
      } else {
        signIn(email, name, phone, data.address);
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
          case 3:
            error = "Recent server restart error. Please reload the page and try again.";
            break;
        }
        //$("#signinError").text("Error: " + error);
        new Modal(error, [{option: "Okay", handler: ()=>{}}]);
      } else {
        signIn(email, data.name, data.phone, data.address);
      }
    }, "json");
  });
});
