/**
 * Planet Terraforming Simulator - Physical Models
 * Simulates climate physics, atmospheric pressures, water phases, albedo feedback, and habitability.
 */

class TerraformSimulator {
  constructor() {
    this.reset();
  }

  reset() {
    // Basic Time & Financial telemetry
    this.years = 0;
    this.budget = 10000.0; // M$ (Millions of Credits)

    // Atmospheric Pressures (in atm)
    // Starting values resemble raw Mars conditions
    this.p_co2 = 0.0095;    // 95% of 0.01 atm
    this.p_o2 = 0.000015;   // ~0.15%
    this.p_n2 = 0.00027;    // ~2.7%
    this.p_water_vapor = 0.0001; // Tiny trace water vapor
    this.p_total = this.p_co2 + this.p_o2 + this.p_n2 + this.p_water_vapor;

    // Climate & Surface Metrics
    this.albedo = 0.25;      // Base Mars albedo
    this.temperature = -63.0; // Average Mars surface temperature (°C)
    
    // Water Inventory (%)
    this.water_ice = 15.0;     // Polar ice caps
    this.water_liquid = 0.0;   // Liquid water coverage
    this.water_total_inventory = 15.0; // Total starting inventory

    // Biosphere (%)
    this.vegetation = 0.0;     // Plant/Algae coverage

    // Habitability Index
    this.survival_index = 0.0; // 0% to 100%

    // Operation settings (rates of action selected by user/AI)
    this.rate_co2 = 0;       // kg/s release rate [0, 100]
    this.rate_comets = 0;    // comets/year [0, 10]
    this.rate_algae = 0;     // algae seeding target coverage [0, 100]
    this.rate_scrubbers = 0; // scrubbers operating capacity [0, 100]

    // Cumulative stats
    this.cost_spent = 0;
    this.comets_struck = 0;
    this.is_habitable = false;
  }

  /**
   * Clones the current simulator state to perform search or rollout inside AI agents
   */
  clone() {
    const copy = new TerraformSimulator();
    copy.years = this.years;
    copy.budget = this.budget;
    copy.p_co2 = this.p_co2;
    copy.p_o2 = this.p_o2;
    copy.p_n2 = this.p_n2;
    copy.p_water_vapor = this.p_water_vapor;
    copy.p_total = this.p_total;
    copy.albedo = this.albedo;
    copy.temperature = this.temperature;
    copy.water_ice = this.water_ice;
    copy.water_liquid = this.water_liquid;
    copy.water_total_inventory = this.water_total_inventory;
    copy.vegetation = this.vegetation;
    copy.survival_index = this.survival_index;
    copy.rate_co2 = this.rate_co2;
    copy.rate_comets = this.rate_comets;
    copy.rate_algae = this.rate_algae;
    copy.rate_scrubbers = this.rate_scrubbers;
    copy.cost_spent = this.cost_spent;
    copy.comets_struck = this.comets_struck;
    copy.is_habitable = this.is_habitable;
    return copy;
  }

  /**
   * Applies the physical simulation equations for a time step dt (years)
   * Typically dt is around 0.5 to 2.0 years depending on simulator speed
   */
  update(dt) {
    this.years += dt;

    // --- 1. BUDGET & COST CYCLE ---
    // If budget runs out, lock all active running operations to 0
    if (this.budget <= 0) {
      this.budget = 0;
      this.rate_co2 = 0;
      this.rate_algae = 0;
      this.rate_scrubbers = 0;
    } else {
      // Calculate operational running costs
      const cost_co2 = this.rate_co2 * 15 * dt;
      const cost_comets = this.rate_comets * 180 * dt;
      const cost_algae = this.rate_algae * 8 * dt;
      const cost_scrubbers = this.rate_scrubbers * 12 * dt;

      const total_running_cost = cost_co2 + cost_comets + cost_algae + cost_scrubbers;
      
      this.budget -= total_running_cost;
      this.cost_spent += total_running_cost;
      
      if (this.budget < 0) {
        // Exceeded budget; scale down rates or zero them
        this.budget = 0;
        this.rate_co2 = 0;
        this.rate_algae = 0;
        this.rate_scrubbers = 0;
      }
    }

    // --- 2. COMET IMPACT PHYSICS ---
    // Comets bring water vapor, nitrogen, and heating
    if (this.rate_comets > 0 && this.budget > 0) {
      const comets_this_step = this.rate_comets * dt;
      this.comets_struck += comets_this_step;

      // Nitrogen increases
      this.p_n2 += comets_this_step * 0.0035; 
      
      // Inject water inventory directly
      this.water_total_inventory += comets_this_step * 0.8;
      
      // Add direct thermal energy from kinetic impact
      this.temperature += comets_this_step * 0.8; 
    }

    // --- 3. ATMOSPHERIC SCRUBBING & EMISSIONS ---
    // CO2 releases from generators
    const co2_emission = this.rate_co2 * 0.0018 * dt;
    this.p_co2 += co2_emission;

    // Atmospheric scrubbers remove carbon dioxide and toxic components
    if (this.rate_scrubbers > 0) {
      const scrub_co2 = this.rate_scrubbers * 0.0012 * dt;
      this.p_co2 = Math.max(0.0005, this.p_co2 - scrub_co2);
    }

    // --- 4. BIOSPHERE PHOTOSYNTHESIS MODEL ---
    // Growth factor of plants and algae is limited by temperature, liquid water, and pressure
    let growth_factor = 0.0;
    if (this.temperature > 0 && this.temperature < 45 && this.water_liquid > 5.0 && this.p_total > 0.08) {
      // Gaussian curve peaking at 25°C
      const temp_growth = Math.exp(-Math.pow((this.temperature - 25) / 12, 2));
      // Water availability factor
      const water_growth = Math.min(1.0, this.water_liquid / 60.0);
      // Carbon dioxide availability
      const co2_growth = Math.min(1.0, this.p_co2 / 0.1);
      
      growth_factor = temp_growth * water_growth * co2_growth;
    }

    // Algae seeding rate adds to the biosphere
    if (this.rate_algae > 0 && this.budget > 0) {
      const target_coverage = this.rate_algae;
      const deviation = target_coverage - this.vegetation;
      if (deviation > 0) {
        // Propagate seeding growth
        this.vegetation += deviation * 0.08 * dt * (growth_factor + 0.15);
      }
    }

    // Natural spreading if fertile environment exists
    if (growth_factor > 0.1 && this.vegetation > 0.5) {
      this.vegetation += 0.8 * growth_factor * dt * (1 - this.vegetation/100);
    } else if (growth_factor === 0.0 && this.vegetation > 0) {
      // Natural decay if conditions are hostile (too cold/hot, no water)
      this.vegetation = Math.max(0.0, this.vegetation - 1.5 * dt);
    }
    this.vegetation = Math.min(100.0, this.vegetation);

    // Photosynthesis converts CO2 into Oxygen
    if (this.vegetation > 0) {
      const convert_rate = (this.vegetation / 100.0) * 0.0028 * dt;
      const consumed_co2 = Math.min(this.p_co2 - 0.0005, convert_rate);
      this.p_co2 -= consumed_co2;
      this.p_o2 += consumed_co2 * 0.85; // Conversional efficiency (some carbon bound to vegetation mass)
    }

    // --- 5. WATER PHASE DYNAMICS ---
    // Calculate water cycle balance based on Temperature and Atmospheric Pressure
    // Sublimation / Melting of Ice Caps
    if (this.temperature > -15.0 && this.water_ice > 0.0) {
      // Rate of melting increases with temperature
      const melt_rate = 0.4 * (this.temperature + 15.0) * dt;
      const actual_melted = Math.min(this.water_ice, melt_rate);
      this.water_ice -= actual_melted;
      this.water_liquid += actual_melted * 0.75;
      this.p_water_vapor += actual_melted * 0.025; // Sublimation to vapor
    } else if (this.temperature <= -15.0 && this.water_liquid > 0.0) {
      // Freezing back to ice caps if cold
      const freeze_rate = 0.3 * (-15.0 - this.temperature) * dt;
      const actual_frozen = Math.min(this.water_liquid, freeze_rate);
      this.water_liquid -= actual_frozen;
      this.water_ice += actual_frozen;
    }

    // Evaporation of liquid water
    if (this.temperature > 0.0 && this.water_liquid > 0.0) {
      const evap_rate = 0.05 * (this.temperature / 100.0) * (this.water_liquid / 100.0) * dt;
      this.water_liquid = Math.max(0.0, this.water_liquid - evap_rate);
      this.p_water_vapor += evap_rate * 0.8;
    }

    // Capping water properties to total inventory
    const total_water_active = this.water_ice + this.water_liquid;
    if (total_water_active > this.water_total_inventory) {
      const overshoot = total_water_active - this.water_total_inventory;
      this.water_ice = Math.max(0.0, this.water_ice - overshoot * 0.5);
      this.water_liquid = Math.max(0.0, this.water_liquid - overshoot * 0.5);
    } else if (total_water_active < this.water_total_inventory * 0.98) {
      // Precipitation / condensation replenish ground water
      const rain = (this.water_total_inventory - total_water_active) * 0.1 * dt;
      if (this.temperature > 0) {
        this.water_liquid += rain;
      } else {
        this.water_ice += rain;
      }
    }
    
    // Bounds check
    this.water_ice = Math.min(80.0, Math.max(0.0, this.water_ice));
    this.water_liquid = Math.min(80.0, Math.max(0.0, this.water_liquid));
    this.p_water_vapor = Math.min(0.05, Math.max(0.0001, this.p_water_vapor));

    // --- 6. PRESSURE CALCULATIONS ---
    this.p_total = this.p_co2 + this.p_o2 + this.p_n2 + this.p_water_vapor;

    // --- 7. REFLECTIVITY (ALBEDO) AND ENERGY BALANCE ---
    // Ice reflects light (0.60 albedo). Water absorbs light (0.10 albedo). 
    // Desert surface is 0.25. Vegetation has albedo of 0.15.
    const f_ice = this.water_ice / 100.0;
    const f_water = this.water_liquid / 100.0;
    const f_veg = this.vegetation / 100.0;
    const f_barren = Math.max(0, 1.0 - (f_ice + f_water + f_veg));

    this.albedo = (0.60 * f_ice) + (0.10 * f_water) + (0.15 * f_veg) + (0.25 * f_barren);
    this.albedo = Math.min(0.60, Math.max(0.08, this.albedo));

    // --- 8. RADIATIVE GREENHOUSE EQUATIONS ---
    // Base temperature decreases as albedo increases (less heat absorbed)
    const base_solar_heating = -63.0 - 45.0 * (this.albedo - 0.25);
    
    // Greenhouse feedback: CO2 acts logarithmically, vapor acts exponentially/square-root
    const co2_factor = Math.max(0.0, this.p_co2);
    const greenhouse_co2 = 38.0 * Math.log(co2_factor * 12.0 + 1.0);
    const greenhouse_vapor = 24.0 * Math.sqrt(this.p_water_vapor * 100.0);

    const target_temperature = base_solar_heating + greenhouse_co2 + greenhouse_vapor;
    
    // Temperature has thermal inertia, smooth transitions step-by-step
    this.temperature += (target_temperature - this.temperature) * 0.15 * dt;

    // --- 9. HABITABILITY / POPULATION SURVIVAL INDEX ---
    // Calculate biological compatibility constraints for standard humans:
    
    // Oxygen: Ideal 0.21 atm partial pressure. Lower threshold 0.15 atm.
    let index_o2 = 0.0;
    if (this.p_o2 > 0.05) {
      if (this.p_o2 >= 0.18 && this.p_o2 <= 0.35) {
        index_o2 = 1.0;
      } else if (this.p_o2 < 0.18) {
        index_o2 = (this.p_o2 - 0.05) / 0.13; // Linear slope
      } else {
        index_o2 = Math.max(0.0, 1.0 - (this.p_o2 - 0.35) / 0.2); // Toxicity decline
      }
    }

    // Temperature: Ideal 15°C. Human ranges 0°C to 30°C.
    let index_temp = 0.0;
    if (this.temperature > -10.0 && this.temperature < 40.0) {
      // Gaussian distribution centered at 15
      index_temp = Math.exp(-Math.pow((this.temperature - 15.0) / 16.0, 2));
    }

    // Pressure: Ideal 1.0 atm. Survivable limit [0.4, 1.8] atm.
    let index_pressure = 0.0;
    if (this.p_total > 0.35 && this.p_total < 2.0) {
      index_pressure = Math.exp(-Math.pow((this.p_total - 1.0) / 0.55, 2));
    }

    // Water coverage: Ideal 60-70% water coverage. Limits [20%, 80%]
    let index_water = 0.0;
    if (this.water_liquid > 10.0) {
      if (this.water_liquid >= 50.0 && this.water_liquid <= 72.0) {
        index_water = 1.0;
      } else if (this.water_liquid < 50.0) {
        index_water = (this.water_liquid - 10.0) / 40.0;
      } else {
        index_water = Math.max(0.0, 1.0 - (this.water_liquid - 72.0) / 8.0);
      }
    }

    // Carbon dioxide toxicity penalty: CO2 is highly toxic above 0.04 atm (4% partial pressure)
    let index_co2_safety = 1.0;
    if (this.p_co2 > 0.01) {
      index_co2_safety = Math.max(0.0, 1.0 - (this.p_co2 - 0.01) / 0.08);
    }

    // Combined Composite Multiplicative Index
    const composite_habitability = index_o2 * index_temp * index_pressure * index_water * index_co2_safety;
    
    // Update survival index smoothly
    this.survival_index = composite_habitability * 100.0;

    if (this.survival_index > 95.0) {
      this.is_habitable = true;
    }
  }

  /**
   * Helper function to trigger instant comets manually (deducts cost immediately)
   */
  triggerCometStrike() {
    const cost = 250.0;
    if (this.budget >= cost) {
      this.budget -= cost;
      this.cost_spent += cost;
      this.comets_struck += 1;
      
      // Inject immediate nitrogen and water vapor
      this.p_n2 += 0.005;
      this.water_total_inventory += 1.2;
      this.p_water_vapor += 0.002;
      this.temperature += 2.0; // Rapid kinetic heating
      return true;
    }
    return false;
  }

  /**
   * Helper function to trigger instant algae bomb manually (deducts cost immediately)
   */
  triggerAlgaeBomb() {
    const cost = 400.0;
    if (this.budget >= cost) {
      this.budget -= cost;
      this.cost_spent += cost;
      
      // Forces immediate increase in bacteria coverage if liquid water exists
      if (this.water_liquid > 2.0) {
        this.vegetation = Math.min(100.0, this.vegetation + 15.0);
        this.p_o2 += 0.008; // Immediate localized oxygen output
        return true;
      }
    }
    return false;
  }
}

// Export for browser usage (global window scope)
if (typeof window !== 'undefined') {
  window.TerraformSimulator = TerraformSimulator;
}
