// api/get-visits.js
// Fixed version for Vercel serverless functions

const DEVELOPER_ROLES = [
    'developer', 'builder', 'scripter', 'programmer',
    'lead developer', 'co-owner', 'owner', 'dev',
    'game developer', 'lead scripter', 'head developer'
];

const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function isDeveloperRole(roleName) {
    const lower = roleName.toLowerCase();
    return DEVELOPER_ROLES.some(role => lower.includes(role));
}

async function fetchJSON(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            error: 'Missing userId parameter',
            usage: 'GET /api/get-visits?userId=123456'
        });
    }
    
    if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid userId - must be numeric' });
    }
    
    // Check cache
    const cacheKey = `visits_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`Cache hit for user ${userId}`);
        return res.status(200).json(cached.data);
    }
    
    try {
        let totalVisits = 0;
        let personalVisits = 0;
        let groupVisits = 0;
        let personalGameCount = 0;
        let groupGameCount = 0;
        
        console.log(`Fetching data for user ${userId}...`);
        
        // Get user's personal games
        try {
            const userGamesData = await fetchJSON(
                `https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=50&sortOrder=Desc`
            );
            
            const userGames = userGamesData.data || [];
            console.log(`Found ${userGames.length} personal games`);
            
            for (const game of userGames) {
                const visits = game.placeVisits || 0;
                personalVisits += visits;
                personalGameCount++;
            }
        } catch (err) {
            console.error('Error fetching user games:', err.message);
        }
        
        // Get user's group memberships
        let groups = [];
        try {
            const groupsData = await fetchJSON(
                `https://groups.roblox.com/v2/users/${userId}/groups/roles`
            );
            groups = groupsData.data || [];
            console.log(`User is in ${groups.length} groups`);
        } catch (err) {
            console.error('Error fetching user groups:', err.message);
        }
        
        // Check each group for developer role
        for (const groupData of groups) {
            const roleName = groupData.role.name;
            
            if (!isDeveloperRole(roleName)) {
                continue;
            }
            
            const groupId = groupData.group.id;
            const groupName = groupData.group.name;
            
            console.log(`User has dev role "${roleName}" in group "${groupName}"`);
            
            try {
                const groupGamesData = await fetchJSON(
                    `https://games.roblox.com/v2/groups/${groupId}/games?accessFilter=1&limit=50&sortOrder=Desc`
                );
                
                const groupGames = groupGamesData.data || [];
                console.log(`  Found ${groupGames.length} games in this group`);
                
                for (const game of groupGames) {
                    const visits = game.placeVisits || 0;
                    groupVisits += visits;
                    groupGameCount++;
                }
            } catch (err) {
                console.error(`Error fetching games for group ${groupId}:`, err.message);
            }
        }
        
        totalVisits = personalVisits + groupVisits;
        const totalGames = personalGameCount + groupGameCount;
        
        console.log(`Total: ${totalVisits} visits across ${totalGames} games`);
        
        const result = {
            success: true,
            totalVisits,
            breakdown: {
                personalVisits,
                groupVisits,
                totalGames,
                personalGames: personalGameCount,
                groupGames: groupGameCount
            },
            note: "Using placeVisits from games API. For exact universe visits, add Roblox Cloud API key.",
            timestamp: new Date().toISOString()
        };
        
        // Cache the result
        cache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        // Clean old cache entries
        if (cache.size > 100) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        
        return res.status(200).json(result);
        
    } catch (error) {
        console.error('Fatal error:', error);
        return res.status(500).json({ 
            success: false,
            error: 'Failed to fetch visit data',
            details: error.message,
            userId: userId
        });
    }
}
