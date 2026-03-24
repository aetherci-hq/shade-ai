export default {
  name: 'weather',
  description: 'Get current weather and forecast for any location',
  source: 'specter-tool-weather',
  config: {
    location: { type: 'string', description: 'Default location (city or zip code)', required: true },
  },
  parameters: {
    location: { type: 'string', description: 'City or zip code. Uses default if omitted', optional: true },
    format: { type: 'string', description: 'Output format: summary, detailed, or forecast', optional: true },
  },
  async execute(params: { location?: string; format?: string }, config?: { location?: string }) {
    const location = params.location ?? config?.location;
    if (!location) {
      throw new Error('No location provided and no default configured. Run setup first.');
    }
    const format = params.format ?? 'summary';
    const encoded = encodeURIComponent(location);

    // wttr.in — free, no API key, supports JSON
    const url = `https://wttr.in/${encoded}?format=j1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'specter-tool-weather/1.0' },
    });

    if (!res.ok) {
      throw new Error(`Weather API returned ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const current = (data['current_condition'] as Record<string, unknown>[])?.[0];
    const nearest = (data['nearest_area'] as Record<string, unknown>[])?.[0];

    if (!current) {
      throw new Error(`No weather data found for "${location}"`);
    }

    const areaName = ((nearest?.['areaName'] as Record<string, string>[])?.[0]?.['value']) ?? location;
    const region = ((nearest?.['region'] as Record<string, string>[])?.[0]?.['value']) ?? '';
    const country = ((nearest?.['country'] as Record<string, string>[])?.[0]?.['value']) ?? '';

    const tempF = current['temp_F'] as string;
    const tempC = current['temp_C'] as string;
    const feelsLikeF = current['FeelsLikeF'] as string;
    const desc = ((current['weatherDesc'] as Record<string, string>[])?.[0]?.['value']) ?? 'Unknown';
    const humidity = current['humidity'] as string;
    const windMph = current['windspeedMiles'] as string;
    const windDir = current['winddir16Point'] as string;
    const visibility = current['visibilityMiles'] as string;
    const uvIndex = current['uvIndex'] as string;
    const precip = current['precipInches'] as string;

    if (format === 'summary') {
      return {
        location: [areaName, region, country].filter(Boolean).join(', '),
        condition: desc,
        temperature: `${tempF}°F (${tempC}°C)`,
        feelsLike: `${feelsLikeF}°F`,
        humidity: `${humidity}%`,
        wind: `${windMph} mph ${windDir}`,
      };
    }

    if (format === 'forecast') {
      const weather = data['weather'] as Record<string, unknown>[];
      const forecast = (weather ?? []).slice(0, 3).map((day: Record<string, unknown>) => {
        const maxF = day['maxtempF'] as string;
        const minF = day['mintempF'] as string;
        const hourly = (day['hourly'] as Record<string, unknown>[])?.[4];
        const dayDesc = ((hourly?.['weatherDesc'] as Record<string, string>[])?.[0]?.['value']) ?? '';
        return {
          date: day['date'] as string,
          high: `${maxF}°F`,
          low: `${minF}°F`,
          condition: dayDesc,
        };
      });
      return {
        location: [areaName, region, country].filter(Boolean).join(', '),
        current: { condition: desc, temperature: `${tempF}°F` },
        forecast,
      };
    }

    // detailed
    return {
      location: [areaName, region, country].filter(Boolean).join(', '),
      condition: desc,
      temperature: { fahrenheit: `${tempF}°F`, celsius: `${tempC}°C`, feelsLike: `${feelsLikeF}°F` },
      humidity: `${humidity}%`,
      wind: { speed: `${windMph} mph`, direction: windDir },
      visibility: `${visibility} miles`,
      uvIndex,
      precipitation: `${precip} in`,
    };
  },
};
