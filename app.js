//config
//these remove the car from the leaderboard
var errorTolerance= 20; //how far a car can go off line before it gets yeeted after it crashes, if the value is too low cars that are still running the line will get removed.
var errorCounterSensitivity = 10; //how quickly a car gets yeeted when it goes off line, lower values = quicker
//these pause the position updating of the car
var timeoutAmount = 50; // how long a car stays timed out after going off line
var timeIncreaseThreshold = 20; // how much a car needs to jump in scriptTime to be considered off line
//end config

var initalized;

var vehicles = [];
var tempVehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "Start line to start leaderboard";
var playerFocusID; //the ID of the car that the player looks at

//time behind leader
var clock;
var timeMode; //the mode of the time behind leader
var leaderCheckpointTime;//the time on the clock when the winner crossed the checkpoint;
var timmings = [];//array consisting the timmings of the cars on the last checkpoint that the winner passed and their ID
var leaderCheckpointIndex;//the last checkpoint that the leader had passed
const CHECKPOINTS_EVERY = 10; //every x ScriptTime there will be an invisible imaginary magical checkpoint


angular.module('beamng.apps')
.directive('raceTicker', ['bngApi', 'StreamsManager', function (bngApi, StreamsManager) {
  return {
    template:  
		` 
		<div style="width:100%; height:100%;" layout="column" layout-align="top left" class="bngApp"><p id="leaderboard"></p>
		<button onclick="function(); "class="TimeModeSwitch"> change the mode of the time behind leader or something please find better text me no englishsky </button>
		<style>.TimeModeSwitch{background-color: Gold; color: CornflowerBlue;} </style>
		`,
    replace: true,
    restrict: 'EA',
    
	link: function (scope, element, attrs) {      
		//Creates a Lua global table in GameEngine Lua
		bngApi.engineLua('script_state_table = {}');
		
		initalized = false;
		
		timeMode = 0; //todo switch to more meaning full thing than 0 or 1 
		leaderCheckpointIndex = 0; // 0 * CHECKPOINTS_EVERY = 0 <------ starting point
		leaderCheckpointTime = 0;
		
		startClock();
		
		
		//This is called all the time
		scope.$on('streamsUpdate', function (event, streams) {
				//This calls GameEngine Lua to tell all Vehicle Luas to insert their serialized ai.scriptState() into the GameEngine Lua script_state_table
				bngApi.engineLua('be:queueAllObjectLua("obj:queueGameEngineLua(\'script_state_table[\'..obj:getID() .. \'] = \' .. serialize(ai.scriptState()))")');
				
				//This gets that script_state_table from GameEngine Lua
				bngApi.engineLua('script_state_table', function(data) {	
					setPlayingFalse();
					for (const [key, value] of Object.entries(data)) {
						let veh_id = key;
						var scriptPercent = value.scriptTime / value.endScriptTime * 100 ;
						var lineError = Math.abs(value.posError);
						var ScriptTimeIncrease= 0;
						//adds id and scriptTime to vehicles array
						if(vehicles.some(vehicle => vehicle.id === veh_id)){//if the vehicle already exists in the array 
							if (getVehicleByID(veh_id).averageLineError>errorTolerance) {
								getVehicleByID(veh_id).playing = "false"; //if the vehicle crashed, delete it
							} else {
								getVehicleByID(veh_id).averageLineError = (errorCounterSensitivity*getVehicleByID(veh_id).averageLineError+lineError)/errorCounterSensitivity+1;
								ScriptTimeIncrease = value.scriptTime-getVehicleByID(veh_id).lastScriptTime;
								getVehicleByID(veh_id).time = value.scriptTime;
								getVehicleByID(veh_id).playing = "true"; //if the vehicle is still playing on line .playing gets set to true
								getVehicleByID(veh_id).ScriptTimeIncrease = ScriptTimeIncrease;
								getVehicleByID(veh_id).lastScriptTime= value.scriptTime;
							}
						}

						else if (lineError<errorTolerance) {//if this vehicle is new
							var vehicle = {"id":veh_id,"time":value.scriptTime,"name":"unknown","playing":"true","ScriptTimeIncrease":0,"lastScriptTime":value.scriptTime,"storedScriptTime":0,"scriptTimePausedTimeout":0,"paused":"false","averageLineError":0,"timeBehindLeaderRT":0,"timeBehindLeaderPrecentage":0};
							vehicles.push(vehicle); //add the new vehicle to the array
							//reading in the vehicles name from Beamng Engine Lua
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								getVehicleByID(veh_id).name = name;//add the name of the new vehicle
							});
						}
					}	
				});
				removeIdleVehicles();
				// manages vehicles maintaining their position for some time when going off-line
				tempVehicles=vehicles;
				var i;
				for (i = 0; i < tempVehicles.length; i++) {
					if (tempVehicles[i].ScriptTimeIncrease > timeIncreaseThreshold) {
						if (vehicles[i].scriptTimePausedTimeout == 0 & vehicles[i].paused == "false") {
							console.log("paused ScriptTime Increasing");
							vehicles[i].storedScriptTime = vehicles[i].lastScriptTime;
							vehicles[i].scriptTimePausedTimeout = timeoutAmount;
							vehicles[i].paused = "true";
						}
						if (vehicles[i].scriptTimePausedTimeout == 0 & vehicles[i].paused == "true") {
							vehicles[i].paused = "false";
						}
						if (vehicles[i].scriptTimePausedTimeout > 0 & vehicles[i].paused == "true") {
							tempVehicles[i].time = vehicles[i].storedScriptTime;
							vehicles[i].scriptTimePausedTimeout = vehicles[i].scriptTimePausedTimeout-1;
						}
					}
				}
				initialize();
				
				
				//formatting information for leaderboard
				vehiclesSorted = tempVehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
				if (vehicles.length > 0) {
					leaderboardFormatted= "";
				}
				//setting playerFocusID to the ID of the car that the player is looking at right now
				bngApi.engineLua('be:getPlayerVehicleID(0)',function(id){
					
					playerFocusID = id;
					
				});
				
				//this should be called every frame
				checkLeaderCheckpoints(vehiclesSorted[0]);
				//maybe this should be called once per x frames to save performance (todo?)
				updateTimings(vehicles);
				
				var i;
				for (i = 0; i < vehiclesSorted.length; i++) {
					let isBold =  false;//if car i should be in bold text (if player looks at it)
					if (vehiclesSorted[i].id == playerFocusID){
						leaderboardFormatted += "<b>";
						isBold = true;
					}
					leaderboardFormatted += (i+1) + "." + vehiclesSorted[i].name + " +"+((i==0)?"":((""+(getVehicleTimingByID(vehiclesSorted[i].id).time)-leaderCheckpointTime)))+"s<br>";
					leaderboardFormatted += (isBold)? "</b>" : "";
				}
		
				document.getElementById("leaderboard").innerHTML = leaderboardFormatted;
		});
	}
	
  };
}])


//things to only do once, but after stuff have been created
function initialize(){
	if (initalized){
		return
	}
	
	
	for (let i =0; i<vehicles.length;i++){//resets the timmings of the cars
		timmings[i] = {"id":vehicles[i].id,"passedCheckpoint":false,"time":0};
	}
	
	
	
	initalize = true;
}


//update the timmings of the cars that crossed the last checkpoint
function updateTimings(vehicles){
	for (let i =0; i<timmings.length;i++){
		if(vehicles[i].lastScriptTime > (leaderCheckpointIndex*CHECKPOINTS_EVERY))//if the vehicle crossed the last checkpoint that the leader crossed
		{
			if (!(getVehicleTimingByID(vehicles[i].id).passedCheckpoint))//if the car did not cross the checkpoint yet = it crossed it now!
			{
				//mark that it crossed the checkpoint
				getVehicleTimingByID(vehicles[i].id).passedCheckpoint = true;
				
				//update the timing of the car crossing the checkpoint
				getVehicleTimingByID(vehicles[i].id).time = clock;
				
			}
		}
	}
	
}

//resets and starts the timer
async function startClock(){
	clock =0;
	setInterval(function(){
    clock+=0.01},10);
	
}


//gets the leader, check if it passed a new checkpoint, if it did, update it and reset the timmings of the other cars
function checkLeaderCheckpoints(leader){
	if (leader.lastScriptTime > (leaderCheckpointIndex+1)*CHECKPOINTS_EVERY){//if the leader passed a new checkpoint
		leaderCheckpointIndex++;
		leaderCheckpointTime = clock;//save the time of the leader
		timmings = [];
		for (let i =0; i<vehicles.length;i++){//resets the timmings of the cars
			timmings[i] = {"id":vehicles[i].id,"passedCheckpoint":false,"time":0};
		}
	}
	
}

//returns the timing of the vehicle with a given ID
 function getVehicleTimingByID(id){
	let index = timmings.findIndex((timmings => timmings.id === id));
	return timmings[index]
}


//returns a vehicle with a given ID
 function getVehicleByID(id){
	let index = vehicles.findIndex((vehicle => vehicle.id === id));
	return vehicles[index]
}

//sets all .playing values to false
function setPlayingFalse(){
	var i;
	if (vehicles.length > 0) {
		for (i = 0; i < vehicles.length; i++) { //sets every .playing to false
			if (vehicles[i].playing == "true"){
				vehicles[i].playing = "false";
			}
		}
	}
}

//removes vehicles from array if they do not have .playing = true
function removeIdleVehicles() {
	var i;
	if (vehicles.length > 0){
	for (i = 0; i < vehicles.length; i++) {
		if (vehicles[i].playing == "false"){
				vehicles.splice(i,1);
				leaderboardFormatted= "Start line to start leaderboard";
			}
		}
	}
}