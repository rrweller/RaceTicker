//config
//these remove the car from the leaderboard
var errorTolerance= 5; //how far a car can go off line before it gets yeeted after it crashes, if the value is too low cars that are still running the line will get removed.
var errorCounterSensitivity = 5; //how quickly a car gets yeeted when it goes off line, lower values = quicker
var jumpDetInterval = 10;
//config end


var playerFocusID; //the ID of the car that the player looks at
var todebug ="";

var vehicles = [];
var tempVehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "Start line to start leaderboard";

var numberOfCars;
var prevVehLength;

var lineEnd;
var totalNumLaps = 0;
var completedNumLaps = 0;
var lapLength= 10000000;

var scriptTimeJumpTimer = 0;
var currentTime

angular.module('beamng.apps')
.directive('raceTicker', [function () {
  return {
    template:  
		`<body><div style="width:100%; height:100%; overflow: hidden;" layout="column" layout-align="top left" class="bngApp">
		<div id="leaderboard"></div></body>
		<div id="top" class="top"></div></body>
		<div id="laps" class="laps"></div></body>
		<div id="cars"></div></body>
		<style> .top {background-color:rgba(100,100,100,0.2);color:white;border: 3px solid white; width: 100%;text-align: center;}</style>
		<style> .laps {display:flex; flex-direction:row; align-items: center; background-color:rgba(100,100,100,0.2); color:white; border: 1px solid white; width: 100%;text-align: right;}</style>
		<style> .lapBTN {
			border-radius: 1px;
			color: #ffffff;
			font-size: 14px;
			background: #d98934;
			padding: 3px 5px 3px 5px;
			border: solid #ffffff 1px;
			}</style>
		<style> .jumperBTN {background-color:blue;color:white;border: 10px solid white;}</style>
		<style> .car {background-color:rgba(100,100,100,0.5);color:white;border: 1px solid white; width: 100%;text-align: left;}</style>
		<style> span {pointer-events: none;}</style>
		`,
    replace: true,
    restrict: 'EA',
	
    
	link: function (scope, element, attrs) {
		//Creates a Lua global table in GameEngine Lua
		bngApi.engineLua('script_state_table = {}');
		bngApi.engineLua('fuel_table = {}');
		
		numberOfCars = 0;
		
		//Top UI Stuff =============================
		
		//initalize images
		fuelimg = document.createElement('img');
		fuelimg.src = 'fuel.png';
			
		//format top of leaderboard
			var top = document.getElementById("top");
			document.getElementById("top").innerHTML = '<b><span style="font-size:24px;">' + "AIT AI Race Leaderboard<br>" + "</span>";
		//-----------------------------------------------------------
				
		//subtract a lap button
			var negLap = document.createElement("button");
			negLap.innerHTML = "-";
			laps.appendChild(negLap);
			negLap.className = "lapBTN";
			negLap.style.order = "1";
			//neglap.style.alignSelf="center";
			negLap.addEventListener("click",function(){
				if(totalNumLaps > 0){
					totalNumLaps = totalNumLaps - 1;
				}
			});
			
		//textbox for # of laps display
			var laptextbox = document.createElement("Text");
			laps.appendChild(laptextbox);
			laptextbox.style.order = "2";
			
		//add a lap button
			var posLap = document.createElement("button");
			posLap.innerHTML = "+";
			laps.appendChild(posLap);
			posLap.className = "lapBTN";
			posLap.style.order = "3";
			posLap.addEventListener("click",function(){
				totalNumLaps = totalNumLaps + 1;
			});
		//-----------------------------------------------------------
				
		//Create checkbox to show fuel amounts or not
			var fuelcheck = document.createElement("input");
			fuelcheck.type = "checkbox";
			fuelcheck.name = "fuelcheck";
			fuelcheck.id = "fuel";
				
			var fuellabel = document.createElement('label');
			fuellabel.htmlFor = "fuel";
				
			fuellabel.appendChild(document.createTextNode(''));
			laps.appendChild(fuelcheck);
			laps.appendChild(fuellabel);
			fuelcheck.style.order = "4";
			fuellabel.style.order = "5";
			
		//Create checkbox to show fuel amounts or not
			var lapsdown = document.createElement("input");
			lapsdown.type = "checkbox";
			lapsdown.name = "lapsdown";
			lapsdown.id = "lapsdn";
				
			var lapsdownlabel = document.createElement('label');
			lapsdownlabel.htmlFor = "lapsdn";
				
			lapsdownlabel.appendChild(document.createTextNode(''));
			laps.appendChild(lapsdown);
			laps.appendChild(lapsdownlabel);
			lapsdown.style.order = "6";
			lapsdownlabel.style.order = "7";
			
			
			
		//Top UI Stuff end ===================================
		

		//This is called all the time
		scope.$on('streamsUpdate', function (event, streams) {
				//This calls GameEngine Lua to tell all Vehicle Luas to insert their serialized ai.scriptState() into the GameEngine Lua script_state_table
				bngApi.engineLua('be:queueAllObjectLua("obj:queueGameEngineLua(\'script_state_table[\'..obj:getID() .. \'] = \' .. serialize(ai.scriptState()))")');
				bngApi.engineLua('be:queueAllObjectLua("obj:queueGameEngineLua(\'fuel_table[\'..obj:getID() .. \'] = \' .. serialize(electrics.values.fuel))")');
				//This gets that script_state_table from GameEngine Lua
				bngApi.engineLua('script_state_table', function(data) {	
					setPlayingFalse();
					var saved = false;
					
					//ScriptTime jump detection timer
					if (scriptTimeJumpTimer > jumpDetInterval+1) {
						scriptTimeJumpTimer == 0;
					} else {
						scriptTimeJumpTimer++;
					}
				
					for (const [key, value] of Object.entries(data)) {
						let veh_id = key;
						var scriptPercent = value.scriptTime / value.endScriptTime * 100 ;
						if(!saved)
						{
							lineEnd = value.endScriptTime;
							saved = true;
						}
						var lineError = Math.abs(value.posError);
						//adds id and scriptTime to vehicles array
						if(vehicles.some(vehicle => vehicle.id === veh_id)){//if the vehicle already exists in the array
							var arrayID = vehicles.findIndex((vehicle => vehicle.id === veh_id));
							vehicles[arrayID].averageLineError = (errorCounterSensitivity*vehicles[arrayID].averageLineError+lineError)/(errorCounterSensitivity+1);
							ScriptTimeIncrease = value.scriptTime-vehicles[arrayID].lastScriptTime;
							vehicles[arrayID].time = value.scriptTime;//if the car isn't crashed, update its time
							currentTime= new Date();
							vehicles[arrayID].playing = true; //if the vehicle is still playing on line .playing gets set to true
							vehicles[arrayID].lastScriptTime= value.scriptTime;
							vehicles[arrayID].lasterScriptTime= vehicles[arrayID].lastScriptTime;
							if (vehicles[arrayID].averageLineError>errorTolerance) {
								if (!vehicles[arrayID].crashed){
								vehicles[arrayID].crashed = true; //if the vehicle crashed, log it
								vehicles[arrayID].storedScriptTime = vehicles[arrayID].lasterScriptTime;
								}
							} else {
								vehicles[arrayID].crashed = false;
							}
							
							//if the vehicle jumped in time, set it to crashed
							if (scriptTimeJumpTimer == jumpDetInterval) {
								if (vehicles[arrayID].scriptTime-vehicles[arrayID].scriptTimeAtSave>(currentTime.getTime()-vehicles[arrayID].realTimeAtSave.getTime())/1000+5)
								vehicles[arrayID].jumped = true;
								vehicles[arrayID].storedScriptTime = vehicles[arrayID].lasterScriptTime;
							}
							if (vehicles[arrayID].jumped) {
								vehicles[arrayID].crashed = true; 
							}
							
						}

						else {//if this vehicle is new
							var vehicle = {"id":veh_id,"time":value.scriptTime,"name":"unknown","playing":true,"lastScriptTime":value.scriptTime,"lasterScriptTime":value.scriptTime,"storedScriptTime":0,"averageLineError":0,"crashed":false,"scriptTimeAtSave":value.scriptTime,"realTimeAtSave":new Date(),"jumped":false};
							vehicles.push(vehicle); //add the new vehicle to the array
							//reading in the vehicles name from Beamng Engine Lua
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								//simplify and add name
								var nameSpaces = name.replace(/_/g," ");
								var nameSplit = nameSpaces.split(" ");
								var simplifiedName= " ";
								var i;
								for(i = 0; i < nameSplit.length; i++){
									simplifiedName += ((nameSplit[i].charAt(0).toUpperCase()) + (nameSplit[i].slice(1))).toString() + " ";
								}
								getVehicleByID(veh_id).name = simplifiedName; 
							});
						}
					}	
				});
				bngApi.engineLua('fuel_table', function(data) {	
					for (const [key, value] of Object.entries(data)) {
						let veh_id = key;
						if(vehicles.some(vehicle => vehicle.id === veh_id)){//if the vehicle already exists in the array 
							getVehicleByID(veh_id).fuel = value;
						}
					}
				});
				removeIdleVehicles();
				bngApi.engineLua('be:getPlayerVehicleID(0)',function(id){
					playerFocusID = id;
				});
				
				// manages vehicles maintaining their position for some time when going off-line
				tempVehicles=vehicles;
				var i;
				for (i = 0; i < tempVehicles.length; i++) {
					if (vehicles[i].crashed) {
						tempVehicles[i].time = vehicles[i].storedScriptTime;
					}
					if (vehicles[i].crashed&&vehicles[i].jumped) {
						tempVehicles[i].time = 0;
					}
				}
				//-----------------------------------------------------------
				
				//formatting information for leaderboard
				vehiclesSorted = tempVehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
				if (vehicles.length !== prevVehLength) {
					numberOfCars = 0;
					document.getElementById("cars").innerHTML= '';
				}
				//-----------------------------------------------------------
				
				//calculate completed Laps
				lapLength= lineEnd/totalNumLaps;
				completedNumLaps=Math.round(vehiclesSorted[0].time/lapLength+0.5);
				//update top buttons
				laptextbox.innerHTML = '<span style="font-size:14px; color:white;">' + "Lap " + completedNumLaps + " / " + totalNumLaps + "</span>";
				laps.appendChild(laptextbox);
				
				fuellabel.innerHTML = '<span style="font-size:14px; color:white;">' + "Show Fuel?" + "</span>";
				laps.appendChild(fuellabel);
				
				lapsdownlabel.innerHTML = '<span style="font-size:14px; color:white;">' + "Laps mode" + "</span>";
				laps.appendChild(lapsdownlabel);
				//-----------------------------------------------------------
				
				
				//make a button for every car
				for (;numberOfCars<vehiclesSorted.length;numberOfCars++){
						
					var button = document.createElement("button");
					button.innerHTML = "If you see this, it means that Oren did something wrong in the code of the clickable cars";
					var leaderboard = document.getElementById("cars");
					leaderboard.appendChild(button);
					button.className  = "car";
					button.id = numberOfCars;
					button.value = (numberOfCars+1);//the value represents the position that the button represents, numberOfCars starting from 0, positions from 1
					button.addEventListener("click",function(){ //on click, jump to the car that that is in the position that is the value of the button
							scope.jumpToCarPos(parseInt((this.value)));
					});
						
				}
				
				prevVehLength= vehicles.length;
				var i;
				for (i = 0; i < vehiclesSorted.length; i++) {
					let carText ="";
					let isBold = false;
					
					if (playerFocusID == vehiclesSorted[i].id ){
						carText+="<b><i>";
						isBold = true;
					}
					
					//-----format crashed cars-----
					if (vehiclesSorted[i].crashed && !lapsdown.checked){
						carText += '<span style="color:#ff5c38; margin: 1px 5px 1px 5px;">' + (i+1) + ": " + vehiclesSorted[i].name + "</span>";
					} else if (vehiclesSorted[i].crashed && lapsdown.checked){
						carText += '<span style="color:yellow; margin: 1px 5px 1px 5px;">'+ (i+1) + ": " + "<span style=\"color:white;\">" + vehiclesSorted[i].name + "<span style=\"color: #ff5c38;font-weight: bold;font-style: italic;\">" + "OUT" + "</span>"
					}
					
					//-----default time behind mode-----
					if (!lapsdown.checked){
						//saves the full line, with or without the fuel remaining
						if(!fuelcheck.checked){
							carText += '<span style="color:yellow; margin: 1px 5px 1px 5px;">' + (i+1) + ": " + "<span style=\"color:white;\">" + vehiclesSorted[i].name + "</span>" +  "      " + (i==0?" <span style=\"color: #3FB0FF;font-weight: bold;font-style: italic;\">" + Math.round((1 - vehiclesSorted[0].time/lineEnd)*100) + "% left" + "</span> ": "<span style=\"color: #ff5c38;font-weight: bold;font-style: italic;\">+" + (Math.round((vehiclesSorted[0].time-vehiclesSorted[i].time)*100)/100).toFixed(2)+"s") +  "</span>";
						}else{
							carText += '<span style="color:yellow; margin: 1px 5px 1px 5px;">' + (i+1) + ": " + "<span style=\"color:white;\">" + vehiclesSorted[i].name + "      " + (i==0?" <span style=\"color: #3FB0FF;font-weight: bold;font-style: italic;\">" + Math.round((1 - vehiclesSorted[0].time/lineEnd)*100) + "% left" + "</span> ": "<span style=\"color: #ff5c38;font-weight: bold;font-style: italic;\">+" + (Math.round((vehiclesSorted[0].time - vehiclesSorted[i].time)*100)/100).toFixed(2)+"s") +  "</span>"  + "<span style=\"color: yellow\">" + " Fuel: "+ (Math.round((vehiclesSorted[i].fuel)*10000)/100).toFixed(1) +"%" +  "</span>";
						}
					}
					
					//-----switch to laps down mode-----
					if (lapsdown.checked){ 		
						var timeBehind = vehiclesSorted[0].time - vehiclesSorted[i].time;
						var lapsComplete = Math.ceil(vehiclesSorted[0].time/lapLength);
						var leadCarText = "";
						var remainingCarText = "test";
						
						//math for the lead car label
						if(lapsComplete > 0 && lapsComplete <= totalNumLaps*0.5){		//for first half of race, label lead car as Lap X of Y
								leadCarText = " Lap " + lapsComplete + " of " + totalNumLaps;
							}else if(lapsComplete > 0 && lapsComplete > totalNumLaps*0.5 && totalNumLaps !== lapsComplete){		//for second half of the race, except on the final lap, label as X laps to go
								leadCarText = (totalNumLaps - lapsComplete + 1) + " Laps to go";
							}else if(lapsComplete > 0 && (totalNumLaps == lapsComplete)){
								leadCarText = " Final Lap";
							}
							
						//math for all other cars labels
						lapsBehind = Math.floor((vehiclesSorted[0].time - vehiclesSorted[i].time) / lapLength);
						
						if(lapsBehind == 0){		//if car is on the lead lap
							remainingCarText = "+" + (Math.round((vehiclesSorted[0].time - vehiclesSorted[i].time)*100)/100).toFixed(2) + "s";
						}else if(lapsBehind == 1){	//if it is one lap down
							remainingCarText = "+" + Math.floor((vehiclesSorted[0].time - vehiclesSorted[i].time)/lapLength) + " Lap";
						}else if(lapsBehind > 1){	//if it is more than one lap down
							remainingCarText = "+" + Math.floor((vehiclesSorted[0].time - vehiclesSorted[i].time)/lapLength) + " Laps";
						}
						
						//saves the full line, with or without the fuel remaining
						if(!fuelcheck.checked){
							carText += '<span style="color:yellow; margin: 1px 5px 1px 5px;">' + (i+1) + ": " + "<span style=\"color:white;\">" + vehiclesSorted[i].name + "</span>" + (i==0?" <span style=\"color: #3FB0FF;font-weight: bold;font-style: italic;\">" + leadCarText + "</span> ": "<span style=\"color: #ff5c38;font-weight: bold;font-style: italic;\">" + remainingCarText) +  "</span>";
						}else{
							carText += '<span style="color:yellow; margin: 1px 5px 1px 5px;">' + (i+1) + ": " + "<span style=\"color:white;\">" + vehiclesSorted[i].name + "</span>" + (i==0?" <span style=\"color: #3FB0FF;font-weight: bold;font-style: italic;\">" + leadCarText + "</span> ": "<span style=\"color: #ff5c38;font-weight: bold;font-style: italic;\">" + remainingCarText) +  "</span>" + "<span style=\"color: yellow\">" + " Fuel: "+ (Math.round((vehiclesSorted[i].fuel)*10000)/100).toFixed(1) +"%" +  "</span>";
						}
					} 
					
					
					if (isBold){
						carText += "</b></i>";
					}
					
					document.getElementById(i).innerHTML = carText;
					//if(fuelcheck.checked){
						//document.getElementById(i).appendChild(fuelimg);
					//}

				}
				
				if (numberOfCars == 0){
					document.getElementById("cars").innerHTML = leaderboardFormatted
				}
				
		});
		
		scope.jumpToCarPos = function(pos){
			debug("player wants to jump to car at pos "+pos)
			bngApi.engineLua('be:enterVehicle("0",scenetree.findObject('+vehiclesSorted[pos-1].id+'))');
		}
	
	}
  };
}])

function debug(str){
	todebug = ""+str;
	
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
			if (vehicles[i].playing){
				vehicles[i].playing = false;
			}
		}
	}
}

//removes vehicles from array if they do not have .playing = true
function removeIdleVehicles() {
	var i;
	if (vehicles.length > 0){
	for (i = 0; i < vehicles.length; i++) {
		if (!vehicles[i].playing){
				vehicles.splice(i,1);
				leaderboardFormatted= "Start line to start leaderboard";
			}
		}
	}
}