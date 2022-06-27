import { Injectable } from '@angular/core';
import { BattleService } from './battle.service';
import { Activity, ActivityLoopEntry, ActivityType } from '../game-state/activity';
import { AttributeType, CharacterAttribute } from '../game-state/character';
import { CharacterService } from '../game-state/character.service';
import { HomeService } from '../game-state/home.service';
import { InventoryService } from '../game-state/inventory.service';
import { ItemRepoService } from '../game-state/item-repo.service';
import { LogService } from './log.service';
import { MainLoopService } from './main-loop.service';
import { ReincarnationService } from './reincarnation.service';
import { ImpossibleTaskService, ImpossibleTaskType } from './impossibleTask.service';
import { FollowersService } from './followers.service';

export interface ActivityProperties {
  autoRestart: boolean,
  pauseOnDeath: boolean,
  activityLoop: ActivityLoopEntry[],
  unlockedActivities: ActivityType[],
  openApprenticeships: number,
  spiritActivity: ActivityType | null,
  completedApprenticeships: ActivityType[];
}

@Injectable({
  providedIn: 'root',
})
export class ActivityService {
  activityLoop: ActivityLoopEntry[] = [];
  spiritActivity: ActivityType | null = null;
  autoRestart: boolean = false;
  pauseOnDeath: boolean = true;
  activities: Activity[] = this.getActivityList();
  openApprenticeships: number = 1;
  oddJobDays: number = 0;
  beggingDays: number = 0;
  completedApprenticeships: ActivityType[] = [];

  constructor(
    private characterService: CharacterService,
    private inventoryService: InventoryService,
    public homeService: HomeService,
    reincarnationService: ReincarnationService,
    private mainLoopService: MainLoopService,
    private itemRepoService: ItemRepoService,
    private battleService: BattleService,
    private logService: LogService,
    private followerService: FollowersService,
    private impossibleTaskService: ImpossibleTaskService
  ) {
    reincarnationService.reincarnateSubject.subscribe(() => {
      this.reset();
    });
    mainLoopService.tickSubject.subscribe(() => {
      if (this.characterService.characterState.dead){
        return;
      }
    });
    mainLoopService.longTickSubject.subscribe(() => {
      this.upgradeActivities();
      this.checkRequirements();
    });

  }

  getProperties(): ActivityProperties{
    let unlockedActivities: ActivityType[] = [];
    for (const activity of this.activities){
      if (activity.unlocked){
        unlockedActivities.push(activity.activityType);
      }
    }
    return {
      autoRestart: this.autoRestart,
      pauseOnDeath: this.pauseOnDeath,
      activityLoop: this.activityLoop,
      unlockedActivities: unlockedActivities,
      openApprenticeships: this.openApprenticeships,
      spiritActivity: this.spiritActivity,
      completedApprenticeships: this.completedApprenticeships
    }
  }

  setProperties(properties: ActivityProperties){
    this.completedApprenticeships = properties.completedApprenticeships || [];
    let unlockedActivities = properties.unlockedActivities || [ActivityType.OddJobs, ActivityType.Resting];
    for (const activity of this.activities){
        activity.unlocked = unlockedActivities.includes(activity.activityType);
    }
    this.autoRestart = properties.autoRestart;
    this.pauseOnDeath = properties.pauseOnDeath;
    this.activityLoop = properties.activityLoop;
    this.spiritActivity = properties.spiritActivity || null;
    this.openApprenticeships = properties.openApprenticeships || 0;
  }

  meetsRequirements(activity: Activity): boolean {
    if (this.meetsRequirementsByLevel(activity, activity.level, true)){
      activity.unlocked = true;
      return true;
    }
    return false;
  }

  meetsRequirementsByLevel(activity: Activity, level: number, apprenticeCheck: boolean): boolean {
    if (apprenticeCheck && !activity.unlocked && this.openApprenticeships <= 0){
      if (level < activity.skipApprenticeshipLevel){
        return false;
      }
      if (activity.skipApprenticeshipLevel > 0 && !this.completedApprenticeships.includes(activity.activityType) ){
        // we've never completed an apprenticeship in this job and it needs one
        return false;
      }
    }
    const keys: (keyof CharacterAttribute)[] = Object.keys(
      activity.requirements[level]
    ) as (keyof CharacterAttribute)[];
    for (const keyIndex in keys) {
      const key = keys[keyIndex];
      let requirementValue = 0;
      if (activity.requirements[level][key] != undefined) {
        requirementValue = activity.requirements[level][key]!;
      }
      if (this.characterService.characterState.attributes[key].value <= requirementValue) {
        return false;
      }
    }
    return true;
  }

  checkRequirements(): void {
    for (let activity of this.activities){
      if (!activity.unlocked && this.meetsRequirements(activity)){
        activity.unlocked = true;
      }
    }
    for (let i = this.activityLoop.length - 1; i >= 0; i--) {
      if (!this.getActivityByType(this.activityLoop[i].activity).unlocked) {
        this.activityLoop.splice(i, 1);
      }
    }
  }

  upgradeActivities(): void {
    for (const activity of this.activities){
      if (activity.level < (activity.description.length - 1)){
        if (this.meetsRequirementsByLevel(activity, (activity.level + 1), false)){
          activity.level++;
          // check to see if we got above apprenticeship skip level
          if (activity.unlocked && activity.skipApprenticeshipLevel == activity.level){
            if (!this.completedApprenticeships.includes(activity.activityType)){
              this.completedApprenticeships.push(activity.activityType);
            }
          }
        }
      }
    }
  }

  reset(): void {
    // downgrade all activities to base level
    this.openApprenticeships = 1;
    this.oddJobDays = 0;
    this.beggingDays = 0;
    for (const activity of this.activities){
      activity.level = 0;
      activity.unlocked = false;
    }
    for (let i = 0; i < 5; i++){
      // upgrade to anything that the starting attributes allow
      this.upgradeActivities();
    }
    this.activities[0].unlocked = true;
    this.activities[1].unlocked = true;
    if (this.autoRestart){
      this.checkRequirements();
      if (this.pauseOnDeath){
        this.mainLoopService.pause = true;
      }
    } else {
      this.activityLoop = [];
    }
  }

  getActivityByType(activityType: ActivityType): Activity {
    for (const activity of this.activities) {
      if (activity.activityType === activityType) {
        return activity;
      }
    }
    throw Error('Could not find activity from type');
  }

  checkApprenticeship(activityType: ActivityType){
    if (this.openApprenticeships == 0){
      return;
    }
    this.openApprenticeships--;
    for (const activity of this.activities) {
      if (activity.activityType !== activityType && activity.level < activity.skipApprenticeshipLevel) {
        // relock all other apprentice activities
        activity.unlocked = false;
        // and remove any entries for them from the activity loop
        for (let i = this.activityLoop.length - 1; i >= 0; i--){
          if (this.activityLoop[i].activity == activity.activityType){
            this.activityLoop.splice(i, 1);
          }
        }
      }
    }
  }

  reloadActivities(){
    this.activityLoop = [];
    this.spiritActivity = null;
    this.activities = this.getActivityList();
  
  }

  getActivityList(): Activity[] {

    if (this.impossibleTaskService.activeTaskIndex == ImpossibleTaskType.Swim){
      return [
        {
          level: 0,
          name: ['Swim Deeper'],
          activityType: ActivityType.Swim,
          description: ['Swim down further into the depths.'],
          consequenceDescription: ['Reduce Stamina by 20. Reduce health by 100.'],
          consequence: [() => {
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.status.health.value -= 100;
            this.impossibleTaskService.tasks[ImpossibleTaskType.Swim].progress++;
            this.impossibleTaskService.checkCompletion();
            if (this.impossibleTaskService.tasks[ImpossibleTaskType.Swim].complete){
              this.logService.addLogMessage("You have acheived the impossible and dived all the way to the bottom of the ocean.","STANDARD","STORY");
            }
          }],
          requirements: [{
          }],
          unlocked: true,
          skipApprenticeshipLevel: 0
        },
      ]
    }

    if (this.impossibleTaskService.activeTaskIndex == ImpossibleTaskType.RaiseIsland){
      return [
        {
          level: 0,
          name: ['Forge Unbreakable Chain'],
          activityType: ActivityType.ForgeChains,
          description: ['Forge a chain strong enough to pull the island from the depths.'],
          consequenceDescription: ['Reduce Stamina by 100. If you have the right facilities and materials you might be able to create an unbreakable chain.'],
          consequence: [() => {
            this.characterService.characterState.status.stamina.value -= 100;
            let metalValue = this.inventoryService.consume('metal');
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "anvil" && metalValue >= 150){
              if (Math.random() > 0.01){
                this.logService.addLogMessage("Your anvil rings with power, a new chain is forged!","STANDARD","EVENT");
                this.inventoryService.addItem(this.itemRepoService.items['unbreakableChain']);
              }
            } else {
              this.logService.addLogMessage("You fumble with the wrong tools and materials and hurt yourself.","INJURY","EVENT");
              this.characterService.characterState.status.health.value -= this.characterService.characterState.status.health.max * 0.05;
            }
          }],
          requirements: [{
          }],
          unlocked: true,
          skipApprenticeshipLevel: 0
        },
        {
          level: 0,
          name: ['Attach Chains to the Island'],
          activityType: ActivityType.AttachChains,
          description: ['Swim deep and attach one of your chains to the island.'],
          consequenceDescription: ['Reduce Stamina by 1000. Requires an unbreakable chain.'],
          consequence: [() => {
            this.characterService.characterState.status.stamina.value -= 1000;
            if (this.inventoryService.consume("chain") > 0){
                this.logService.addLogMessage("You attach a chain to the island. and give your chains a tug.","STANDARD","EVENT");
                this.impossibleTaskService.tasks[ImpossibleTaskType.RaiseIsland].progress++;
                this.impossibleTaskService.checkCompletion();
                if (this.impossibleTaskService.tasks[ImpossibleTaskType.RaiseIsland].complete){
                  this.logService.addLogMessage("With a mighty pull, the island comes loose. You haul it to the surface.","STANDARD","STORY");
                }
            } else {
              this.logService.addLogMessage("You fumble around in the depths without a chain until a shark comes by and takes a bite.","INJURY","EVENT");
              this.characterService.characterState.status.health.value -= this.characterService.characterState.status.health.max * 0.05;
            }
          }],
          requirements: [{
          }],
          unlocked: true,
          skipApprenticeshipLevel: 0
        },
      ]
    }

    return [
      {
        level: 0,
        name: ['Odd Jobs'],
        activityType: ActivityType.OddJobs,
        description:
          ['Run errands, pull weeds, clean toilet pits, or do whatever else you can to earn a coin. Undignified work for a future immortal, but you have to eat to live.'],
        consequenceDescription:
          ['Uses 5 stamina. Increases a random attribute and provides a little money.'],
        consequence: [() => {
          const keys = Object.keys(
            this.characterService.characterState.attributes
          ) as AttributeType[];
          // randomly choose any of the first five stats
          const key = keys[Math.floor(Math.random() * 5)];
          this.characterService.characterState.increaseAttribute(key, 0.1);
          this.characterService.characterState.status.stamina.value -= 5;
          this.characterService.characterState.money += 3;
          this.oddJobDays++;
        }],
        requirements: [{}],
        unlocked: true,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Resting', 'Meditation', 'Communing With Divinity'],
        activityType: ActivityType.Resting,
        description:['Take a break and get some sleep. Good sleeping habits are essential for cultivating immortal attributes.',
          'Enter a meditative state and begin your journey toward spritual enlightenment.',
          'Extend your senses beyond the mortal realm and connect to deeper realities.'],
        consequenceDescription: ['Restores half your stamina and a little health.',
          'Restores all your stamina and some health.',
          'Restores all your stamina, health, and mana.'],
        consequence: [
          () => {
            this.characterService.characterState.status.stamina.value +=
              this.characterService.characterState.status.stamina.max / 2;
            this.characterService.characterState.status.health.value += 2;
            this.characterService.characterState.checkOverage();
          },
          () => {
            this.characterService.characterState.status.stamina.value = this.characterService.characterState.status.stamina.max;
            this.characterService.characterState.status.health.value += 10;
            if (Math.random() < 0.01){
              this.characterService.characterState.increaseAttribute('spirituality', 0.1);
            }
            if (this.characterService.characterState.manaUnlocked){
              this.characterService.characterState.status.mana.value += 1;
            }
            this.characterService.characterState.checkOverage();
          },
          () => {
            this.characterService.characterState.status.stamina.value = this.characterService.characterState.status.stamina.max;
            this.characterService.characterState.status.health.value = this.characterService.characterState.status.health.max;
            this.characterService.characterState.status.mana.value = this.characterService.characterState.status.mana.max;
            this.characterService.characterState.increaseAttribute('spirituality', 0.1);
            this.characterService.characterState.checkOverage();
          }
        ],
        requirements: [
          {},
          {
            strength: 1000,
            speed: 1000,
            charisma: 1000,
            intelligence: 1000,
            toughness: 1000
          },
          {
            strength: 1000000,
            speed: 1000000,
            charisma: 1000000,
            intelligence: 1000000,
            toughness: 1000000,
            spirituality: 100000,
            fireLore: 10000,
            waterLore: 10000,
            earthLore: 10000,
            metalLore: 10000,
            woodLore: 10000,
          }
        ],
        unlocked: true,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Begging', 'Street Performing', 'Oration', 'Politics'],
        activityType: ActivityType.Begging,
        description:[
          'Find a nice spot on the side of the street, look sad, and put your hand out. Someone might put a coin in it if you are charasmatic enough.',
          'Add some musical flair to your begging.',
          'Move the crowds with your stirring speeches.',
          'Charm your way into civic leadership.',
        ],
        consequenceDescription:[
          'Uses 5 stamina. Increases charisma and provides a little money.',
          'Uses 5 stamina. Increases charisma and provides some money.',
          'Uses 5 stamina. Increases charisma and provides money.',
          'Uses 5 stamina. Increases charisma, provides money, and makes you wonder what any of this means for your immortal progression.'
        ],
        consequence: [
          () => {
            this.characterService.characterState.increaseAttribute('charisma',0.1);
            this.characterService.characterState.status.stamina.value -= 5;
            this.characterService.characterState.money += 3 +
              Math.log2(this.characterService.characterState.attributes.charisma.value);
            this.beggingDays++;
          },
          () => {
            this.characterService.characterState.increaseAttribute('charisma',0.2);
            this.characterService.characterState.status.stamina.value -= 5;
            this.characterService.characterState.money += 10 +
              Math.log2(this.characterService.characterState.attributes.charisma.value);
            this.beggingDays++;
            },
          () => {
            this.characterService.characterState.increaseAttribute('charisma',0.3);
            this.characterService.characterState.status.stamina.value -= 5;
            this.characterService.characterState.money += 20 +
              Math.log2(this.characterService.characterState.attributes.charisma.value * 2);
            this.beggingDays++;
            },
          () => {
            this.characterService.characterState.increaseAttribute('charisma',0.5);
            this.characterService.characterState.status.stamina.value -= 5;
            this.characterService.characterState.money += 30 +
              Math.log2(this.characterService.characterState.attributes.charisma.value * 10);
            this.beggingDays++;
            }
        ],
        requirements: [
          {
            charisma: 3,
          },
          {
            charisma: 100
          },
          {
            charisma: 5000
          },
          {
            charisma: 10000
          }
        ],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Apprentice Blacksmithing', 'Journeyman Blacksmithing', 'Blacksmithing', 'Master Blacksmithing'],
        activityType: ActivityType.Blacksmithing,
        description:[
          "Work for the local blacksmith. You mostly pump the bellows, but at least you're learning a trade.",
          'Mold metal into useful things. You might even produce something you want to keep now and then.',
          'Create useful and beautiful metal objects. You might produce a decent weapon occasionally.',
          'Work the forges like a true master.',
        ],
        consequenceDescription:[
          'Uses 25 stamina. Increases strength and toughness and provides a little money.',
          'Uses 25 stamina. Increases strength, toughness, and money.',
          'Uses 25 stamina. Build your physical power, master your craft, and create weapons.',
          'Uses 50 stamina. Bring down your mighty hammer and create works of metal wonder.',
        ],
        consequence: [
          // grade 0
          () => {
            this.checkApprenticeship(ActivityType.Blacksmithing);
            this.characterService.characterState.increaseAttribute('strength', 0.1);
            this.characterService.characterState.increaseAttribute('toughness', 0.1);
            this.characterService.characterState.status.stamina.value -= 25;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
                this.characterService.characterState.attributes.toughness.value) +
              this.characterService.characterState.attributes.metalLore.value;
            let blacksmithSuccessChance = 0.01;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "anvil"){
              blacksmithSuccessChance += 0.05;
            }
            if (Math.random() < blacksmithSuccessChance) {
              this.inventoryService.addItem(this.itemRepoService.items['junk']);
              this.characterService.characterState.increaseAttribute('metalLore', 0.1);
            }
          },
          // grade 1
          () => {
            this.checkApprenticeship(ActivityType.Blacksmithing);
            this.characterService.characterState.increaseAttribute('strength',0.2);
            this.characterService.characterState.increaseAttribute('toughness',0.2);
            this.characterService.characterState.status.stamina.value -= 25;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.toughness.value) +
              (this.characterService.characterState.attributes.metalLore.value * 2);
            let blacksmithSuccessChance = 0.02;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "anvil"){
              blacksmithSuccessChance += 0.05;
            }
            if (Math.random() < blacksmithSuccessChance) {
              this.characterService.characterState.increaseAttribute('metalLore', 0.2);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('metal');
                if (grade >= 1){ // if the metal was found
                  this.inventoryService.addItem(this.inventoryService.generateWeapon(
                      (grade / 10) + Math.floor(Math.log2(this.characterService.characterState.attributes.metalLore.value)), 'metal'));
                }
              }
            }
          },
          // grade 2
          () => {
            this.characterService.characterState.increaseAttribute('strength',0.5);
            this.characterService.characterState.increaseAttribute('toughness',0.5);
            this.characterService.characterState.status.stamina.value -= 25;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.toughness.value) +
              this.characterService.characterState.attributes.fireLore.value +
              (this.characterService.characterState.attributes.metalLore.value * 5);
            let blacksmithSuccessChance = 0.05;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "anvil"){
              blacksmithSuccessChance += 0.05;
            }
            if (Math.random() < blacksmithSuccessChance) {
              this.characterService.characterState.increaseAttribute('metalLore',0.3);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('metal');
                if (grade >= 1){ // if the metal was found
                  this.inventoryService.addItem(this.inventoryService.generateWeapon(
                    (grade / 10) + Math.floor(Math.log2(this.characterService.characterState.attributes.metalLore.value)), 'metal'));
                }
              }
            }
          },
          // grade 3
          () => {
            this.characterService.characterState.increaseAttribute('strength', 1);
            this.characterService.characterState.increaseAttribute('toughness', 1);
            this.characterService.characterState.status.stamina.value -= 50;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.toughness.value) +
              this.characterService.characterState.attributes.fireLore.value +
              (this.characterService.characterState.attributes.metalLore.value * 10);
            let blacksmithSuccessChance = 0.2;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "anvil"){
              blacksmithSuccessChance += 0.2;
            }
            if (Math.random() < blacksmithSuccessChance) {
              this.characterService.characterState.increaseAttribute('metalLore',0.5);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('metal');
                if (grade >= 1){ // if the metal was found
                  this.inventoryService.addItem(this.inventoryService.generateWeapon(
                    (grade / 5) + Math.floor(Math.log2(this.characterService.characterState.attributes.metalLore.value)), 'metal'));
                }
              }
            }
          }
        ],
        requirements: [
          {
            strength: 50,
            toughness: 50,
          },
          {
            strength: 400,
            toughness: 400,
            metalLore: 1,
          },
          {
            strength: 2000,
            toughness: 2000,
            metalLore: 10,
          },
          {
            strength: 10000,
            toughness: 10000,
            metalLore: 100,
            fireLore: 10
          }
        ],
        unlocked: false,
        skipApprenticeshipLevel: 2
      },
      {
        level: 0,
        name: ['Gathering Herbs'],
        activityType: ActivityType.GatherHerbs,
        description: ['Search the natural world for useful herbs.'],
        consequenceDescription: ['Uses 10 stamina. Find herbs and learn about plants'],
        consequence: [() => {
          this.characterService.characterState.increaseAttribute('intelligence',0.1);
          this.characterService.characterState.increaseAttribute('speed', 0.1);
          this.characterService.characterState.status.stamina.value -= 10;
          // the grade on herbs probably needs diminishing returns
          this.inventoryService.generateHerb();
          if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == 'herbGarden'){
            this.inventoryService.generateHerb();
          }
          if (Math.random() < 0.01) {
            this.characterService.characterState.increaseAttribute('woodLore',0.1);
          }
        }],
        requirements: [{
          speed: 20,
          intelligence: 20,
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Apprentice Alchemy', 'Journeyman Alchemy', 'Alchemy', 'Master Alchemy'],
        activityType: ActivityType.Alchemy,
        description: [
          'Get a job at the alchemist\'s workshop. It smells awful but you might learn a few things.',
          'Get a cauldron and do a little brewing of your own.',
          'Open up your own alchemy shop.',
          'Brew power, precipitate life, stir in some magic, and create consumable miracles.',
        ],
        consequenceDescription: [
          'Uses 10 stamina. Get smarter, make a few taels, and learn the secrets of alchemy.',
          'Uses 10 stamina. Get smarter, make money, practice your craft. If you have some herbs, you might make a usable potion or pill.',
          'Uses 10 stamina. Get smarter, make money, and make some decent potions or pills.',
          'Uses 20 stamina. Create amazing potions and pills.'
        ],
        consequence: [
          () => {
            this.checkApprenticeship(ActivityType.Alchemy);
            this.characterService.characterState.increaseAttribute('intelligence',0.1);
            this.characterService.characterState.status.stamina.value -= 10;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.intelligence.value) +
              this.characterService.characterState.attributes.waterLore.value;
            let alchemySuccessChance = 0.01;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "cauldron"){
              alchemySuccessChance += 0.05;
            }
            if (Math.random() < alchemySuccessChance) {
              this.characterService.characterState.increaseAttribute('woodLore',0.05);
              this.characterService.characterState.increaseAttribute('waterLore',0.1);
            }
          },
          () => {
            this.checkApprenticeship(ActivityType.Alchemy);
            this.characterService.characterState.increaseAttribute('intelligence',0.2);
            this.characterService.characterState.status.stamina.value -= 10;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.intelligence.value) +
              (this.characterService.characterState.attributes.waterLore.value * 2);
            let alchemySuccessChance = 0.02;
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "cauldron"){
              alchemySuccessChance += 0.05;
            }
            if (Math.random() < alchemySuccessChance) {
              this.characterService.characterState.increaseAttribute('woodLore',0.1);
              this.characterService.characterState.increaseAttribute('waterLore',0.2);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('ingredient');
                if (grade >= 1){ // if the ingredient was found
                  grade += Math.floor(Math.log2(this.characterService.characterState.attributes.waterLore.value));
                  this.inventoryService.generatePotion(grade, false);
                }
              }
            }
          },
          () => {
            this.characterService.characterState.increaseAttribute('intelligence',0.5);
            this.characterService.characterState.status.stamina.value -= 10;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.intelligence.value) +
              (this.characterService.characterState.attributes.waterLore.value * 5);
            let alchemySuccessChance = 1 - Math.exp(0 - 0.025 * Math.log(this.characterService.characterState.attributes.waterLore.value));
            if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "cauldron"){
              alchemySuccessChance += 0.05;
            }
            if (Math.random() < alchemySuccessChance) {
              this.characterService.characterState.increaseAttribute('woodLore',0.2);
              this.characterService.characterState.increaseAttribute('waterLore',0.3);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('ingredient');
                if (grade >= 1){ // if the ingredient was found
                  grade += Math.floor(Math.log2(this.characterService.characterState.attributes.waterLore.value));
                  this.inventoryService.generatePotion(grade + 1, false);
                }
              }
            }
          },
          () => {
            this.characterService.characterState.increaseAttribute('intelligence', 1);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.intelligence.value) +
              (this.characterService.characterState.attributes.waterLore.value * 10);
            this.characterService.characterState.increaseAttribute('woodLore',0.3);
            this.characterService.characterState.increaseAttribute('waterLore',0.6);
            if (this.inventoryService.openInventorySlots() > 0){
              let grade = this.inventoryService.consume('ingredient');
              if (grade >= 1){ // if the ingredient was found
                grade += Math.floor(Math.log2(this.characterService.characterState.attributes.waterLore.value));
                this.inventoryService.generatePotion(grade + 1, true);
              }
            }
          }
        ],
        requirements: [
          {
            intelligence: 200,
          },
          {
            intelligence: 1000,
            waterLore: 10,
            woodLore: 1
          },
          {
            intelligence: 8000,
            waterLore: 100,
            woodLore: 10
          },
          {
            intelligence: 100000,
            waterLore: 1000,
            woodLore: 100
          }
        ],
        unlocked: false,
        skipApprenticeshipLevel: 2
      },
      {
        level: 0,
        name: ['Chopping Wood'],
        activityType: ActivityType.ChopWood,
        description: ['Work as a woodcutter, cutting logs in the forest.'],
        consequenceDescription: ["Uses 10 stamina. Get a log and learn about plants."],
        consequence: [() => {
          this.characterService.characterState.increaseAttribute('strength',0.1);
          this.characterService.characterState.status.stamina.value -= 10;
          this.inventoryService.addItem(this.inventoryService.getWood());
          if (Math.random() < 0.01) {
            this.characterService.characterState.increaseAttribute('woodLore',0.1);
          }
        }],
        requirements: [{
          strength: 100,
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Apprentice Woodworking', 'Journeyman Woodworking', 'Woodworking'],
        activityType: ActivityType.Woodworking,
        description: [
          'Work in a woodcarver\'s shop.',
          'Carve wood into useful items.',
          'Open your own woodworking shop.'
        ],
        consequenceDescription:[
          'Uses 20 stamina. Increases strength and intelligence and provides a little money.',
          'Uses 20 stamina. Increases strength and intelligence and provides a little money. You may make something you want to keep now and then.',
          'Uses 20 stamina. Increases strength and intelligence, earn some money, create wooden equipment.',
        ],
        consequence: [
          () => {
            this.checkApprenticeship(ActivityType.Woodworking);
            this.characterService.characterState.increaseAttribute('strength', 0.1);
            this.characterService.characterState.increaseAttribute('intelligence', 0.1);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.intelligence.value) +
              this.characterService.characterState.attributes.woodLore.value;
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('woodLore', 0.1);
            }
          },
          () => {
            this.checkApprenticeship(ActivityType.Woodworking);
            this.characterService.characterState.increaseAttribute('strength',0.2);
            this.characterService.characterState.increaseAttribute('intelligence',0.2);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.intelligence.value) +
              (this.characterService.characterState.attributes.woodLore.value * 2);
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('woodLore',0.2);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('wood');
                if (grade >= 1){ // if the wood was found
                  this.inventoryService.addItem(this.inventoryService.generateWeapon(
                    grade + Math.floor(Math.log2(this.characterService.characterState.attributes.woodLore.value)), 'wood'));
                }
              }
            }
          },
          () => {
            this.characterService.characterState.increaseAttribute('strength',0.5);
            this.characterService.characterState.increaseAttribute('intelligence',0.5);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.strength.value +
              this.characterService.characterState.attributes.intelligence.value) +
              (this.characterService.characterState.attributes.woodLore.value * 5);
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('woodLore',0.3);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('wood');
                if (grade >= 1){ // if the wood was found
                  this.inventoryService.addItem(this.inventoryService.generateWeapon(
                    grade + Math.floor(Math.log2(this.characterService.characterState.attributes.woodLore.value)), 'wood'));
                }
              }
            }
          }
        ],
        requirements: [
          {
            strength: 100,
            intelligence: 100
          },
          {
            strength: 800,
            intelligence: 800,
            woodLore: 1,
          },
          {
            strength: 2000,
            intelligence: 2000,
            woodLore: 10,
          }
        ],
        unlocked: false,
        skipApprenticeshipLevel: 2
      },
      {
        level: 0,
        name: ['Apprentice Leatherworking', 'Journeyman Leatherworking', 'Leatherworking'],
        activityType: ActivityType.Leatherworking,
        description: [
          'Work in a tannery, where hides are turned into leather items.',
          'Convert hides into leather items.',
          'Open your own tannery.'
        ],
        consequenceDescription:[
          'Uses 20 stamina. Increases speed and toughness and provides a little money.',
          'Uses 20 stamina. Increases speed and toughness and provides a little money. You may make something you want to keep now and then.',
          'Uses 20 stamina. Increases speed and toughness, earn some money, create leather equipment.',
        ],
        consequence: [
          () => {
            this.checkApprenticeship(ActivityType.Leatherworking);
            this.characterService.characterState.increaseAttribute('speed', 0.1);
            this.characterService.characterState.increaseAttribute('toughness', 0.1);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.speed.value +
              this.characterService.characterState.attributes.toughness.value) +
              this.characterService.characterState.attributes.animalHandling.value;
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('animalHandling', 0.1);
            }
          },
          () => {
            this.checkApprenticeship(ActivityType.Leatherworking);
            this.characterService.characterState.increaseAttribute('speed',0.2);
            this.characterService.characterState.increaseAttribute('toughness',0.2);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.speed.value +
              this.characterService.characterState.attributes.toughness.value) +
              (this.characterService.characterState.attributes.animalHandling.value * 2);
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('animalHandling',0.2);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('hide');
                if (grade >= 1){ // if the wood was found
                  this.inventoryService.addItem(this.inventoryService.generateArmor(
                    grade + Math.floor(Math.log2(this.characterService.characterState.attributes.animalHandling.value)), 'leather',
                    this.inventoryService.randomArmorSlot()));
                }
              }
            }
          },
          () => {
            this.characterService.characterState.increaseAttribute('speed',0.5);
            this.characterService.characterState.increaseAttribute('toughness',0.5);
            this.characterService.characterState.status.stamina.value -= 20;
            this.characterService.characterState.money +=
              Math.log2(this.characterService.characterState.attributes.speed.value +
              this.characterService.characterState.attributes.toughness.value) +
              (this.characterService.characterState.attributes.animalHandling.value * 5);
            if (Math.random() < 0.01) {
              this.characterService.characterState.increaseAttribute('animalHandling',0.3);
              if (this.inventoryService.openInventorySlots() > 0){
                let grade = this.inventoryService.consume('hide');
                if (grade >= 1){ // if the wood was found
                  this.inventoryService.addItem(this.inventoryService.generateArmor(
                    grade + Math.floor(Math.log2(this.characterService.characterState.attributes.animalHandling.value)), 'leather',
                    this.inventoryService.randomArmorSlot()));
                }
              }
            }
          }
        ],
        requirements: [
          {
            speed: 100,
            toughness: 100
          },
          {
            speed: 800,
            toughness: 800,
            animalHandling: 1,
          },
          {
            speed: 2000,
            toughness: 2000,
            animalHandling: 10,
          }
        ],
        unlocked: false,
        skipApprenticeshipLevel: 2
      },
      {
        level: 0,
        name: ['Farming'],
        activityType: ActivityType.Farming,
        description:
          ['Plant crops in your fields. This is a waste of time if you don\'t have some fields ready to work.'],
        consequenceDescription:
          ['Uses 20 stamina. Increases strength and speed and helps your fields to produce more food.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 20;
          let farmPower = Math.floor(Math.log10(this.characterService.characterState.attributes.woodLore.value + this.characterService.characterState.attributes.earthLore.value));
          if (farmPower < 1){
            farmPower = 1;
          }
          this.homeService.workFields(farmPower);
          this.characterService.characterState.increaseAttribute('strength', 0.1);
          this.characterService.characterState.increaseAttribute('speed', 0.1);
          if (Math.random() < 0.01) {
            this.characterService.characterState.increaseAttribute('woodLore', 0.1);
            this.characterService.characterState.increaseAttribute('earthLore', 0.1);
          }
      }],
        requirements: [{
          strength: 10,
          speed: 10
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Mining'],
        activityType: ActivityType.Mining,
        description: ['Dig in the ground for useable minerals.'],
        consequenceDescription: ['Uses 20 stamina. Increases strength and sometimes finds something useful.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 20;
          this.characterService.characterState.increaseAttribute('strength', 0.1);
          if (Math.random() < 0.5) {
            this.characterService.characterState.increaseAttribute('earthLore', 0.1);
            this.inventoryService.addItem(this.inventoryService.getOre());
          }
        }],
        requirements: [{
          strength: 70
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Smelting'],
        activityType: ActivityType.Smelting,
        description: ['Smelt metal ores into usable metal.'],
        consequenceDescription: ['Uses 30 stamina. Increases toughness and intelligence. If you have metal ores, you can make them into bars.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 20;
          this.characterService.characterState.increaseAttribute('toughness', 0.1);
          this.characterService.characterState.increaseAttribute('intelligence', 0.1);
          if (this.inventoryService.openInventorySlots() > 0){
            let grade = this.inventoryService.consume("ore");
            if (grade >= 1){
              this.inventoryService.addItem(this.inventoryService.getBar(grade));
            }
          }
        }],
        requirements: [{
          toughness: 100,
          intelligence: 100
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Hunting'],
        activityType: ActivityType.Hunting,
        description: ['Hunt for animals in the nearby woods.'],
        consequenceDescription: ['Uses 50 stamina. Increases speed and a good hunt provides some meat. It might draw unwanted attention to yourself.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 50;
          this.characterService.characterState.increaseAttribute('speed', 0.1);
          let huntingSuccessChance = 0.1;
          if (this.homeService.furniture.workbench && this.homeService.furniture.workbench.id == "dogKennel"){
            huntingSuccessChance += 0.4;
          }
          if (Math.random() < huntingSuccessChance) {
            this.characterService.characterState.increaseAttribute('animalHandling', 0.1);
            this.inventoryService.addItem(this.itemRepoService.items['meat']);
            this.inventoryService.addItem(this.itemRepoService.items['hide']);
          }
          if (Math.random() < 0.01) {
            this.battleService.addEnemy(this.battleService.enemyRepo.wolf);
          }
        }],
        requirements: [{
          speed: 200
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Fishing'],
        // cormorant fishing later!
        activityType: ActivityType.Fishing,
        description: ['Grab your net and see if you can catch some fish.'],
        consequenceDescription: ['Uses 50 stamina. Increases intelligence and strength and you might catch a fish.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 50;
          this.characterService.characterState.increaseAttribute('strength', 0.1);
          this.characterService.characterState.increaseAttribute('intelligence', 0.1);
          if (Math.random() < 0.2) {
            this.characterService.characterState.increaseAttribute('animalHandling', 0.1);
            this.characterService.characterState.increaseAttribute('waterLore', 0.05);
            this.inventoryService.addItem(this.itemRepoService.items['carp']);
          }
        }],
        requirements: [{
          strength: 15,
          intelligence: 15
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Burning Things'],
        activityType: ActivityType.Burning,
        description: ['Light things on fire and watch them burn.'],
        consequenceDescription: ['Uses 5 stamina. You will be charged for what you burn. Teaches you to love fire.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 5;
          let moneyCost = this.characterService.characterState.increaseAttribute('fireLore', 0.1);
          this.characterService.characterState.money -= moneyCost;
          if (this.characterService.characterState.money < 0){
            this.characterService.characterState.money = 0;
          }
        }],
        requirements: [{
          intelligence: 10
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Body Cultivation'],
        activityType: ActivityType.BodyCultivation,
        description: ['Focus on the development of your body. Unblock your meridians, let your chi flow, and prepare your body for immortality.'],
        consequenceDescription: ['Uses 100 stamina. Increases your physical abilities and strengthen your aptitudes in them.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 100;
          this.characterService.characterState.increaseAttribute('strength', 1);
          this.characterService.characterState.increaseAttribute('speed', 1);
          this.characterService.characterState.increaseAttribute('toughness', 1);
          this.characterService.characterState.attributes.strength.aptitude += 0.1;
          this.characterService.characterState.attributes.speed.aptitude += 0.1;
          this.characterService.characterState.attributes.toughness.aptitude += 0.1;
          if (Math.random() < 0.01){
            this.characterService.characterState.increaseAttribute('spirituality', 0.1);
          }
        }],
        requirements: [{
          strength: 5000,
          speed: 5000,
          toughness: 5000,
          spirituality: 1
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Mind Cultivation'],
        activityType: ActivityType.MindCultivation,
        description: ['Focus on the development of your mind. Unblock your meridians, let your chi flow, and prepare your mind for immortality.'],
        consequenceDescription: ['Uses 100 stamina. Increases your mental abilities and strengthen your aptitudes in them.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 100;
          this.characterService.characterState.increaseAttribute('intelligence', 1);
          this.characterService.characterState.increaseAttribute('charisma', 1);
          this.characterService.characterState.attributes.intelligence.aptitude += 0.1;
          this.characterService.characterState.attributes.charisma.aptitude += 0.1;
          if (Math.random() < 0.01){
            this.characterService.characterState.increaseAttribute('spirituality', 0.1);
          }
        }],
        requirements: [{
          charisma: 5000,
          intelligence: 5000,
          spirituality: 1
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Core Cultivation'],
        activityType: ActivityType.CoreCultivation,
        description: ['Focus on the development of your soul core.'],
        consequenceDescription: ['A very advances cultivation technique. Make sure you have achieved a deep understanding of elemental balance before attempting this. Uses 200 stamina. Gives you a small chance of increasing your mana capabilities.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 200;
          if (this.characterService.characterState.manaUnlocked){
            if (Math.random() < 0.01){
              this.characterService.characterState.status.mana.max++;
              this.characterService.characterState.status.mana.value++;
            }
          } else {
            let damage = this.characterService.characterState.status.health.max * 0.1;
            this.characterService.characterState.status.health.value -= damage;
            this.logService.addLogMessage("You fail miserably at cultivating your core and hurt yourself badly.","INJURY","EVENT");
          }
        }],
        requirements: [{
          woodLore: 1000,
          waterLore: 1000,
          fireLore: 1000,
          metalLore: 1000,
          earthLore: 1000,
          spirituality: 1000
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      },
      {
        level: 0,
        name: ['Recruit Followers'],
        activityType: ActivityType.Recruiting,
        description: ['Look for followers willing to serve you.'],
        consequenceDescription: ['Costs 100 stamina and 1M taels. Gives you a small chance of finding a follower, if you are powerful to attract any.'],
        consequence: [() => {
          this.characterService.characterState.status.stamina.value -= 100;
          this.characterService.characterState.money -= 1000000;
          if (this.characterService.characterState.money < 0){
            this.characterService.characterState.money = 0;
          }
          if (this.followerService.followersUnlocked && this.characterService.characterState.money > 0){
            if (Math.random() < 0.01){
              this.followerService.generateFollower();
            }
          } else {
            let damage = this.characterService.characterState.status.health.max * 0.1;
            this.characterService.characterState.status.health.value -= damage;
            this.logService.addLogMessage("You fail miserably at your attempt to recruit followers. An angry mob chases you down and gives you a beating for your arrogance.","INJURY","EVENT");
          }
        }],
        requirements: [{
          charisma: 1000000000,
        }],
        unlocked: false,
        skipApprenticeshipLevel: 0
      }
    ];
  }
}