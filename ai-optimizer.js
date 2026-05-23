/**
 * Planet Terraforming Simulator - AI Optimization Agents
 * Implements Heuristic Hill Climbing, Genetic Algorithm, and Q-Learning RL client-side.
 */

class AIOptimizer {
  constructor(simulator) {
    this.sim = simulator;
    this.isRunning = false;
    this.strategy = 'hill-climbing'; // hill-climbing, genetic-algorithm, reinforcement-learning
    
    // Objective weights (Speed, Cost, Safety)
    this.w_speed = 7;
    this.w_cost = 4;
    this.w_safety = 5;

    // RL Q-Table storage
    this.qTable = {}; // Key: stateCode, Value: Array of Q-values for actions
    this.rlActions = [
      { name: "Idle / Maintain", co2: 0, comets: 0, algae: 0, scrub: 0 },
      { name: "Greenhouse Emissions", co2: 60, comets: 0, algae: 0, scrub: 0 },
      { name: "Comet Harvesting", co2: 0, comets: 1.5, algae: 0, scrub: 0 },
      { name: "Biosphere Planting", co2: 0, comets: 0, algae: 50, scrub: 0 },
      { name: "Pressure Scrubbing", co2: 0, comets: 0, algae: 0, scrub: 40 },
      { name: "Thermal Flooding (CO2 + Comets)", co2: 80, comets: 2.0, algae: 0, scrub: 0 },
      { name: "Oxygenation Phase (Algae + Scrub)", co2: 0, comets: 0, algae: 70, scrub: 30 },
      { name: "Full Scale Terraforming", co2: 90, comets: 2.5, algae: 80, scrub: 40 }
    ];

    this.onLog = null; // Callback for printing logs: (text, type) => {}
  }

  log(msg, type = 'info') {
    if (this.onLog) {
      this.onLog(`[AI Agent] ${msg}`, type);
    } else {
      console.log(`[AI Agent] [${type}] ${msg}`);
    }
  }

  setWeights(speed, cost, safety) {
    this.w_speed = speed;
    this.w_cost = cost;
    this.w_safety = safety;
    this.log(`Updated objective weights: Speed=${speed}, Cost=${cost}, Safety=${safety}`);
  }

  /**
   * Main fitness function mapping planetary state to an objective score
   */
  calculateFitness(simState) {
    const H = simState.survival_index;
    
    // Calculate metric distances to targets to guide the AI when H is 0
    // (Helps bypass the flat "cold start" fitness region of Mars)
    const d_o2 = Math.abs(simState.p_o2 - 0.21) / 0.21;
    const d_temp = Math.abs(simState.temperature - 15.0) / 80.0;
    const d_water = Math.abs(simState.water_liquid - 60.0) / 60.0;
    const d_pressure = Math.abs(simState.p_total - 1.0) / 1.0;
    
    // Distance metric score (0 is perfect, negative is bad)
    const metrics_fitness = -(d_o2 + d_temp + d_water + d_pressure) * 100.0;

    // Running operational cost rate (cost per step)
    const running_cost_rate = (simState.rate_co2 * 15) + 
                              (simState.rate_comets * 180) + 
                              (simState.rate_algae * 8) + 
                              (simState.rate_scrubbers * 12);
    
    // Cost penalty: higher cost reduces fitness, scaled by user preference
    const cost_penalty = (running_cost_rate / 1500.0) * this.w_cost * 15.0;

    // Safety penalty: high toxicity (excess CO2, extreme temperatures, or atmospheric pressure extremes)
    let safety_penalty = 0;
    if (simState.p_co2 > 0.05) {
      safety_penalty += (simState.p_co2 - 0.05) * 200.0;
    }
    if (simState.temperature > 40 || simState.temperature < -20) {
      safety_penalty += 30.0;
    }
    if (simState.p_total > 1.8 || simState.p_total < 0.3) {
      safety_penalty += 45.0;
    }
    safety_penalty *= this.w_safety;

    // Reward for reaching a habitable state
    const habitability_reward = H * this.w_speed * 3.5;

    // Composite Fitness
    return habitability_reward + (metrics_fitness * 0.4) - cost_penalty - safety_penalty;
  }

  /**
   * 1. Greedily adjusts sliders one parameter at a time.
   */
  decideHillClimbing(dt) {
    const controls = ['rate_co2', 'rate_comets', 'rate_algae', 'rate_scrubbers'];
    const currentSliders = {
      rate_co2: this.sim.rate_co2,
      rate_comets: this.sim.rate_comets,
      rate_algae: this.sim.rate_algae,
      rate_scrubbers: this.sim.rate_scrubbers
    };

    let bestFitness = -Infinity;
    let bestAction = { ...currentSliders };
    let reason = "Maintaining current operational trajectory.";

    // Discretized step sizes for testing adjustments
    const steps = {
      rate_co2: [-20, 0, 20],
      rate_comets: [-0.5, 0, 0.5],
      rate_algae: [-15, 0, 15],
      rate_scrubbers: [-15, 0, 15]
    };

    // Test combinations
    for (const ctrl of controls) {
      for (const step of steps[ctrl]) {
        const testSliders = { ...currentSliders };
        
        // Apply adjustment with bounds wrapping
        if (ctrl === 'rate_co2') testSliders.rate_co2 = Math.min(100, Math.max(0, testSliders.rate_co2 + step));
        if (ctrl === 'rate_comets') testSliders.rate_comets = Math.min(10, Math.max(0, testSliders.rate_comets + step));
        if (ctrl === 'rate_algae') testSliders.rate_algae = Math.min(100, Math.max(0, testSliders.rate_algae + step));
        if (ctrl === 'rate_scrubbers') testSliders.rate_scrubbers = Math.min(100, Math.max(0, testSliders.rate_scrubbers + step));

        // Evaluate prediction
        const testSim = this.sim.clone();
        Object.assign(testSim, testSliders);
        testSim.update(dt * 3); // Simulate 3 steps ahead to see short-term momentum
        
        const fitness = this.calculateFitness(testSim);
        if (fitness > bestFitness) {
          bestFitness = fitness;
          bestAction = testSliders;
          if (step > 0) {
            reason = `Increasing ${ctrl.replace('rate_', '')} by ${step} to optimize climate metrics.`;
          } else if (step < 0) {
            reason = `Decreasing ${ctrl.replace('rate_', '')} by ${Math.abs(step)} to reduce cost rates/toxicity.`;
          }
        }
      }
    }

    this.log(reason, 'info');
    return bestAction;
  }

  /**
   * 2. Genetic Algorithm
   * Evolves a sequence of slider settings over generations.
   */
  decideGeneticAlgorithm(dt) {
    const planLength = 5; // Search horizon (e.g. 5 steps of dt)
    const popSize = 20;
    const generations = 4;
    const mutationRate = 0.25;

    // Helper to generate a random chromosome gene (slider settings)
    const randomGene = () => ({
      rate_co2: Math.random() * 100,
      rate_comets: Math.random() * 5,
      rate_algae: Math.random() * 100,
      rate_scrubbers: Math.random() * 100
    });

    // Helper to generate a random chromosome (sequence of planLength actions)
    const randomChromosome = () => {
      const chrom = [];
      for (let i = 0; i < planLength; i++) {
        chrom.push(randomGene());
      }
      return chrom;
    };

    // Fitness evaluation for a chromosome
    const evaluateChromosome = (chrom) => {
      const testSim = this.sim.clone();
      let totalFitness = 0;
      
      for (let i = 0; i < planLength; i++) {
        Object.assign(testSim, chrom[i]);
        testSim.update(dt);
        totalFitness += this.calculateFitness(testSim);
      }
      return totalFitness / planLength; // Average fitness over horizon
    };

    // 1. Initialize population
    let population = [];
    for (let i = 0; i < popSize; i++) {
      population.push({
        chrom: randomChromosome(),
        fitness: -Infinity
      });
    }

    // 2. Evolutionary cycle
    for (let gen = 0; gen < generations; gen++) {
      // Evaluate fitness
      for (let i = 0; i < popSize; i++) {
        population[i].fitness = evaluateChromosome(population[i].chrom);
      }

      // Sort by fitness descending
      population.sort((a, b) => b.fitness - a.fitness);

      // Keep elite and breed remaining
      const nextGen = [population[0], population[1]]; // Elitism
      
      while (nextGen.length < popSize) {
        // Selection (Tournament Selection)
        const parentA = this.tournamentSelect(population, 3);
        const parentB = this.tournamentSelect(population, 3);
        
        // Crossover (Single point)
        const crossoverPoint = Math.floor(Math.random() * planLength);
        const childChrom = [];
        for (let i = 0; i < planLength; i++) {
          if (i < crossoverPoint) {
            childChrom.push({ ...parentA.chrom[i] });
          } else {
            childChrom.push({ ...parentB.chrom[i] });
          }
        }

        // Mutation
        for (let i = 0; i < planLength; i++) {
          if (Math.random() < mutationRate) {
            const key = ['rate_co2', 'rate_comets', 'rate_algae', 'rate_scrubbers'][Math.floor(Math.random() * 4)];
            if (key === 'rate_co2') childChrom[i].rate_co2 = Math.min(100, Math.max(0, childChrom[i].rate_co2 + (Math.random() * 40 - 20)));
            if (key === 'rate_comets') childChrom[i].rate_comets = Math.min(10, Math.max(0, childChrom[i].rate_comets + (Math.random() * 2 - 1)));
            if (key === 'rate_algae') childChrom[i].rate_algae = Math.min(100, Math.max(0, childChrom[i].rate_algae + (Math.random() * 30 - 15)));
            if (key === 'rate_scrubbers') childChrom[i].rate_scrubbers = Math.min(100, Math.max(0, childChrom[i].rate_scrubbers + (Math.random() * 30 - 15)));
          }
        }

        nextGen.push({
          chrom: childChrom,
          fitness: -Infinity
        });
      }
      population = nextGen;
    }

    // Evaluate final gen fitnesses
    for (let i = 0; i < popSize; i++) {
      population[i].fitness = evaluateChromosome(population[i].chrom);
    }
    population.sort((a, b) => b.fitness - a.fitness);

    // Grab the first action from the best evolved chromosome sequence
    const bestPlan = population[0].chrom;
    const bestAction = bestPlan[0];

    this.log(`GA Gen 4 evolved best plan. Predicted fitness: ${population[0].fitness.toFixed(1)}. Execute plan step 1.`, 'success');
    return bestAction;
  }

  tournamentSelect(pop, tournamentSize) {
    let best = null;
    for (let i = 0; i < tournamentSize; i++) {
      const ind = pop[Math.floor(Math.random() * pop.length)];
      if (!best || ind.fitness > best.fitness) {
        best = ind;
      }
    }
    return best;
  }

  /**
   * 3. Reinforcement Learning (Tabular Q-Learning)
   * Discretizes state space and trains Q-values in the background.
   */
  trainRLAgent(dt) {
    this.log("Initializing background Q-Learning simulation...", "warn");
    this.qTable = {}; // Clear Q-table

    const alpha = 0.15;  // Learning rate
    const gamma = 0.92;  // Discount factor
    const episodes = 1500;
    const stepsPerEpisode = 40;

    let totalUpdates = 0;

    for (let ep = 0; ep < episodes; ep++) {
      // Start from a randomized state resembling current simulator state with deviations
      // to cover the local state landscape.
      const trainSim = this.sim.clone();
      if (Math.random() < 0.6) {
        // Tweak slightly to explore
        trainSim.p_co2 = Math.max(0.0005, trainSim.p_co2 + (Math.random() * 0.05 - 0.02));
        trainSim.p_o2 = Math.max(0.0, trainSim.p_o2 + (Math.random() * 0.04 - 0.01));
        trainSim.water_liquid = Math.max(0.0, trainSim.water_liquid + (Math.random() * 30.0 - 10.0));
        trainSim.temperature = Math.max(-100.0, Math.min(100.0, trainSim.temperature + (Math.random() * 40.0 - 20.0)));
        trainSim.p_total = trainSim.p_co2 + trainSim.p_o2 + trainSim.p_n2 + trainSim.p_water_vapor;
      }

      for (let step = 0; step < stepsPerEpisode; step++) {
        const s = this.getDiscretizedState(trainSim);
        
        // Initialize state inside Q-table if not present
        if (!this.qTable[s]) {
          this.qTable[s] = new Array(this.rlActions.length).fill(0.0);
        }

        // Action selection (Epsilon-greedy)
        const epsilon = 0.25 - 0.20 * (ep / episodes); // Decay
        let actionIdx = 0;
        if (Math.random() < epsilon) {
          actionIdx = Math.floor(Math.random() * this.rlActions.length);
        } else {
          // Exploit
          let maxVal = -Infinity;
          for (let a = 0; a < this.rlActions.length; a++) {
            if (this.qTable[s][a] > maxVal) {
              maxVal = this.qTable[s][a];
              actionIdx = a;
            }
          }
        }

        // Execute action in simulation clone
        const action = this.rlActions[actionIdx];
        trainSim.rate_co2 = action.co2;
        trainSim.rate_comets = action.comets;
        trainSim.rate_algae = action.algae;
        trainSim.rate_scrubbers = action.scrub;
        
        // Before state fitness
        const fitBefore = this.calculateFitness(trainSim);
        
        trainSim.update(dt);
        
        // After state
        const sPrime = this.getDiscretizedState(trainSim);
        const fitAfter = this.calculateFitness(trainSim);
        
        // Reward: Change in fitness plus a bonus for survival index
        let reward = (fitAfter - fitBefore) * 2.0;
        if (trainSim.survival_index > 0) {
          reward += trainSim.survival_index * 1.5;
        }
        if (trainSim.is_habitable) {
          reward += 1000.0; // Terminal goal achieved
        }
        // Budget constraint penalty
        if (trainSim.budget <= 0) {
          reward -= 200.0;
        }

        // Init next state inside Q-table if not present
        if (!this.qTable[sPrime]) {
          this.qTable[sPrime] = new Array(this.rlActions.length).fill(0.0);
        }

        // Temporal Difference update
        const maxQPrime = Math.max(...this.qTable[sPrime]);
        this.qTable[s][actionIdx] += alpha * (reward + gamma * maxQPrime - this.qTable[s][actionIdx]);

        totalUpdates++;
        if (trainSim.is_habitable || trainSim.budget <= 0) {
          break; // Episode terminates
        }
      }
    }

    this.log(`Reinforcement Q-Learning trained successfully. Size: ${Object.keys(this.qTable).length} state grids mapped. Updates: ${totalUpdates}`, "success");
  }

  /**
   * Helper: Discretizes planetary parameters into a string hash code
   */
  getDiscretizedState(simState) {
    // 1. Oxygen (5 bins)
    let o2_bin = 0;
    if (simState.p_o2 > 0.01) o2_bin = 1;
    if (simState.p_o2 > 0.08) o2_bin = 2;
    if (simState.p_o2 > 0.16) o2_bin = 3;
    if (simState.p_o2 >= 0.20) o2_bin = 4;

    // 2. Temp (5 bins)
    let temp_bin = 0;
    if (simState.temperature > -40) temp_bin = 1;
    if (simState.temperature > -10) temp_bin = 2;
    if (simState.temperature > 10) temp_bin = 3;
    if (simState.temperature >= 22) temp_bin = 4;

    // 3. Water (5 bins)
    let water_bin = 0;
    if (simState.water_liquid > 5) water_bin = 1;
    if (simState.water_liquid > 25) water_bin = 2;
    if (simState.water_liquid > 50) water_bin = 3;
    if (simState.water_liquid >= 68) water_bin = 4;

    // 4. Pressure (5 bins)
    let press_bin = 0;
    if (simState.p_total > 0.1) press_bin = 1;
    if (simState.p_total > 0.4) press_bin = 2;
    if (simState.p_total > 0.8) press_bin = 3;
    if (simState.p_total >= 1.2) press_bin = 4;

    return `O${o2_bin}T${temp_bin}W${water_bin}P${press_bin}`;
  }

  /**
   * Evaluates current state against Q-table and triggers optimal policy action.
   */
  decideReinforcementLearning(dt) {
    const s = this.getDiscretizedState(this.sim);
    
    // If state hasn't been mapped, run a mini localized train
    if (!this.qTable[s]) {
      this.log("Unmapped state configuration. Running corrective learning pass...", "warn");
      this.trainRLAgent(dt);
    }

    const stateQ = this.qTable[s] || new Array(this.rlActions.length).fill(0.0);
    
    // Find action with highest Q value
    let bestIdx = 0;
    let maxQ = -Infinity;
    for (let i = 0; i < stateQ.length; i++) {
      if (stateQ[i] > maxQ) {
        maxQ = stateQ[i];
        bestIdx = i;
      }
    }

    const action = this.rlActions[bestIdx];
    this.log(`State code ${s} matched. Policy: "${action.name}" (Q-Value: ${maxQ.toFixed(1)}).`, "success");

    return {
      rate_co2: action.co2,
      rate_comets: action.comets,
      rate_algae: action.algae,
      rate_scrubbers: action.scrub
    };
  }

  /**
   * Decides which action block to return based on strategy choice
   */
  step(dt) {
    if (this.strategy === 'hill-climbing') {
      return this.decideHillClimbing(dt);
    } else if (this.strategy === 'genetic-algorithm') {
      return this.decideGeneticAlgorithm(dt);
    } else if (this.strategy === 'reinforcement-learning') {
      return this.decideReinforcementLearning(dt);
    }
    return null;
  }
}

// Export for browser usage
if (typeof window !== 'undefined') {
  window.AIOptimizer = AIOptimizer;
}
