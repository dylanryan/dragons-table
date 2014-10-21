var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var cors = require('cors');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var fs = require('fs');
var names = require('../www/js/shared/names.js');

var state = {
	objects: [],
};

var minClientVersion = '0.3.0';


app.use(bodyParser.json());
app.use(cors());

var parentDir = __dirname.substring(0, __dirname.lastIndexOf('/'));
app.use('/play', express.static(parentDir + '/www'));

app.get('/', function(req, res) {
	res.send(JSON.stringify(state));
});

app.post('/', function(req, res) {
	console.log(req.body);
	state = req.body;
});

function addSocketHandler(socket, command, handler) {
	socket.on(command, function(msg){
		var ret = handler(socket,msg);
		if (!ret) { return; }
		var logOb = {
			  type: command,
			  time: new Date()/1,
			  data: ret
		};

		saveChatlog(JSON.stringify(logOb)+"\n");
	});
}

io.on('connection', function(socket) {
	socket.playerData={};
	console.log('WebSockets connection started');
	addSocketHandler(socket,'identify',onIdentify);
	addSocketHandler(socket,'debug test',onDebugTest);
	addSocketHandler(socket,'disconnect',onDisconnect);
	var interval=setInterval(function(){
		if (socket.disconnected || socket.identified)
		{
			clearTimeout(interval);
			return;
		}
		console.log("Requesting re-identification...");
		socket.emit('re-identify');
	},1000);
});

var CHATLOG_NAME=null;
function saveChatlog(str){
	fs.appendFileSync(getChatlogName(),str);
}
function getChatlogName(){
	if (CHATLOG_NAME) { return CHATLOG_NAME; }

	// Final format is chatlogs/name yyyy-mm-dd hh_mm_ss.log
	// Using underscores in time because : is reserved on mac
	var d = new Date();

	var year = d.getFullYear();

	var month = d.getMonth() + 1; // Months returned 0-based FNAR.
	if (month < 10) { month='0'+month; }

	var day = d.getDate();
	if (day < 10) { day = '0' + day; }

	var hours = d.getHours();
	if (hours < 10) { hours = '0' + hours; }

	var minutes = d.getMinutes();
	if (minutes < 10) { minutes = '0' + minutes; }

	var seconds = d.getSeconds();
	if (seconds < 10) { seconds = '0' + seconds; }

	try{
		fs.mkdirSync("chatlogs");
	} catch(e) {
		// EEXIST is ok
		if (e.code != 'EEXIST') {
			console.error(e);
		}
	}
	CHATLOG_NAME="chatlogs/chatlog "+year+"-"+month+"-"+day+" "+hours+"_"+minutes+"_"+seconds+".log";
	return CHATLOG_NAME;
}


// -----------------------------------------------------------------------------
// Handlers
function onIdentify(socket,msg) {
	if (socket.identified) { return; } // DO NOT allow multiple identifies, that way lies madness.
	socket.identified = true; // Ensure that this is set as early as possible to mitigate potential races

	console.log("connection identified as: " + JSON.stringify(msg));

	if (validVersion(msg.version)) {
		var n=names.createName(msg.username);
		if(!n) {
			socket.emit('invalid player name',msg.username);
		}

		socket.emit('map sync', state);
		socket.playerData.username=n;
		socket.broadcast.emit('players connected',[n]);
		var others=[];
		for(var i=0;i<io.sockets.sockets.length;++i) {
			if(io.sockets.sockets[i]!=socket && io.sockets.sockets[i].identified && !io.sockets.sockets[i].disconnected) {
				others.push(io.sockets.sockets[i].playerData.username);
			}
		}
		if(others.length) {
			socket.emit('players connected',others);
		}

		addSocketHandler(socket,'map sync',onMapSync);
		addSocketHandler(socket,'ghost',onGhost);
		addSocketHandler(socket,'chat',onChat);
	} else {
		socket.emit('alert', "Update your client.\n\nYour version: " + msg.version + '\nMinimum version: ' + minClientVersion);
		console.log('Obsolete connection detected. Data: ' + JSON.stringify(msg));
	}
	return msg;
}
function onDebugTest(socket,msg) {
	socket.emit('debug test echo', msg);
	return false;
}
function onMapSync(socket,msg) {
	console.log("map sync triggered with: " + JSON.stringify(msg));
	state = msg;
	socket.broadcast.emit('map sync', msg);
	return msg;
}
function onGhost(socket,msg) {
	socket.broadcast.emit('ghost', msg);
	return false;
}
function onChat(socket,msg) {
	// TODO: Do SO MUCH MORE here.
	var n="Unidentified Player";
	if(socket.playerData && socket.playerData.username) {
		n=socket.playerData.username.canonical;
	}
	msg.from=n;
	socket.broadcast.emit('chat', msg);
	socket.emit('chat', msg);
	return msg;
}
function onDisconnect(socket,msg) {
	var n="Unidentified Player";
	if(socket.playerData && socket.playerData.username) {
		n=socket.playerData.username.canonical;
	}
	socket.broadcast.emit('player disconnected',n);
	console.log("WebSocket disconnceted for "+n);
	return {username:n}
}
// End Handlers
// -----------------------------------------------------------------------------

http.listen(3000, function(){
	console.log('listening on *:3000');
});

function validVersion(version) {
	var min = minClientVersion.split(/\.-/);
	var actual = version.split(/\.-/);
	
	for (var i = 0; i < min.length; ++i) {
		if (actual[i] > min[i]) {
			return true;
		} else if (actual[i] < min[i]) {
			return false;
		}
	}
	return true;
}
