import { parseMatch } from '$lib/start.gg/helper';
import {
	WrappedSelections,
	WrappedSets,
	WrappedTournamentsAndSetsOnStream
} from '$lib/start.gg/queries';
import client from '$lib/start.gg/start.gg';
import { json } from '@sveltejs/kit';
import redis from '$lib/redis';
import { z } from 'zod';

const responseSchema = z.object({
	player: z.object({
		id: z.string(),
		name: z.string(),
		image: z.string().optional(),
		selection: z.object({
			stages: z.record(z.number()),
			characters: z.record(z.number())
		}),
		achievements: z.object({
			shutoutsDealt: z.number()
		})
	}),
	tournament: z.object({
		perMonth: z.array(z.object({ month: z.number(), total: z.number() })),
		mostAttendees: z.object({
			name: z.string(),
			numAttendees: z.number()
		}),
		total: z.number(),
		online: z.number(),
		offline: z.number()
	}),
	set: z.object({
		total: z.number(),
		setsOnStream: z.number(),
		recurringOpponents: z.array(z.object({ id: z.string(), name: z.string(), count: z.number() }))
	})
});

export const GET = async ({ params }) => {
	const playerId = params.id;

	const REDIS_KEY = `player:${playerId}`;

	// Check if the player's data is in the KV store
	const playerData = await redis.get(REDIS_KEY);
	if (playerData) {
		const safePlayerData = responseSchema.safeParse(playerData);
		if (safePlayerData.success) return json(safePlayerData.data);
	}

	const res = await client.query(WrappedTournamentsAndSetsOnStream, {
		playerId,
		videoGameId: '1386'
	});

	const thisYear = 2024;
	const tournamentsThisYear =
		res.data?.player?.user?.tournaments?.nodes
			?.filter((tournament) => {
				if (!tournament?.startAt) return false;
				const year = new Date(parseInt(tournament.startAt) * 1000).getFullYear();
				return year === thisYear;
			})
			.filter((tournament) => tournament !== null) || [];

	// Tournaments attended
	const onlineTournaments = tournamentsThisYear.filter(
		(tournament) => tournament?.hasOnlineEvents && !tournament?.hasOfflineEvents
	);
	const offlineTournaments = tournamentsThisYear.filter(
		(tournament) => tournament?.hasOfflineEvents
	);

	const tournamentsPerMonth = Array.from({ length: 12 }, (_, i) => {
		const month = i + 1;
		return {
			month,
			total: tournamentsThisYear.filter((tournament) => {
				if (!tournament?.startAt) return false;

				const tournamentDate = new Date(parseInt(tournament.startAt) * 1000);
				const tournamentMonth = tournamentDate.getMonth() + 1;
				return tournamentMonth === month;
			}).length
		};
	});

	const tournamentWithMostAttendees = offlineTournaments.reduce(
		(previousTournament, tournament) => {
			if ((tournament.numAttendees ?? 0) > (previousTournament.numAttendees ?? 0)) {
				return tournament;
			}
			return previousTournament;
		},
		offlineTournaments[0] ?? {}
	);

	// Sets on stream
	const setsOnStream = res.data?.player?.sets?.pageInfo?.total ?? 0;

	const offlineTournamentsIds = offlineTournaments
		.map((tournament) => tournament.id)
		.filter((id) => id !== null);

	const resSets1stPage = await client.query(WrappedSets, {
		playerId,
		tournamentsIds: offlineTournamentsIds,
		page: 1,
		perPage: 50
	});

	const recurringOpponents = {} as Record<
		string,
		{
			name: string;
			count: number;
		}
	>;

	const totalPages = resSets1stPage.data?.player?.sets?.pageInfo?.totalPages ?? 0;

	// Fetch all sets pages
	const allPagesPromises = Array.from({ length: totalPages - 1 }, (_, i) => {
		return client.query(WrappedSets, {
			playerId,
			tournamentsIds: offlineTournamentsIds,
			page: i + 2,
			perPage: 50
		});
	});

	const allPagesResults = await Promise.all(allPagesPromises);
	let shutoutsDealt = 0;
	// Used later to get the player's selections
	const playerEntrantIds = [] as string[];

	// Process all sets from all pages
	allPagesResults.forEach((page) => {
		page.data?.player?.sets?.nodes?.forEach((set) => {
			const winnerId = set?.winnerId;
			if (!winnerId) return;

			if (!set.game) return;
			if (!set.game.selections) return;

			const opponent = set.game.selections.find((selection) => {
				const participants = selection?.entrant?.participants;
				if (!participants) return false;
				return !participants.map((p) => String(p?.player?.id)).includes(playerId);
			});

			const playerEntrant = set.game.selections.find((selection) => {
				const participants = selection?.entrant?.participants;
				if (!participants) return false;
				return participants.map((p) => String(p?.player?.id)).includes(playerId);
			});

			if (playerEntrant && playerEntrant.entrant && playerEntrant.entrant.id)
				playerEntrantIds.push(playerEntrant.entrant.id);

			if (!opponent) return;
			if (!opponent.entrant) return;
			if (!opponent.entrant.participants) return;
			if (opponent.entrant.participants.length > 1) return;
			if (!opponent.entrant.participants[0]?.player) return;

			const opponentPlayerId = opponent.entrant.participants[0].player.id;
			if (!opponentPlayerId) return;

			const prefix = opponent.entrant.participants[0].player.prefix;
			const gamerTag = opponent.entrant.participants[0].player.gamerTag;

			const name = prefix ? `${prefix} ${gamerTag}` : (gamerTag as string);

			if (!recurringOpponents[opponentPlayerId]) {
				recurringOpponents[opponentPlayerId] = {
					name,
					count: 0
				};
			}

			recurringOpponents[opponentPlayerId].count++;

			// Check for shutouts
			if (!set.displayScore) return;
			const score = parseMatch(set.displayScore);
			if (score === 'DQ') return;

			const opponentScore = score.find((s) => s.name === name);
			if (!opponentScore) return;

			if (opponentScore.score === 0) shutoutsDealt++;
		});
	});

	// Sort recurring opponents by count
	const sortedRecurringOpponents = Object.entries(recurringOpponents)
		.sort(([, a], [, b]) => b.count - a.count)
		.map(([id, data]) => ({
			id,
			...data
		}))
		.slice(0, 3);

	/********************** Selections **********************/
	const playedStages = {} as Record<string, number>;
	const characters = {} as Record<string, number>;
	const resSelections1stPage = await client.query(WrappedSelections, {
		playerId,
		tournamentsIds: offlineTournamentsIds,
		page: 1,
		perPage: 50
	});

	const totalPagesSelections = resSelections1stPage.data?.player?.sets?.pageInfo?.totalPages ?? 0;
	const allSelectionsPromises = Array.from({ length: totalPagesSelections - 1 }, (_, i) => {
		return client.query(WrappedSelections, {
			playerId,
			tournamentsIds: offlineTournamentsIds,
			page: i + 2,
			perPage: 50
		});
	});

	const allSelectionsResults = await Promise.all(allSelectionsPromises);

	// Process all selections from all pages
	allSelectionsResults.forEach((page) => {
		page.data?.player?.sets?.nodes?.forEach((set) => {
			const games = set?.games;
			if (!games) return;

			games.forEach((game) => {
				// Add the stage to the playedStages
				if (!game?.stage) return;
				if (!game.stage.name) return;

				playedStages[game.stage.name] = (playedStages[game.stage.name] || 0) + 1;

				const playerSelection = game.selections?.find((selection) => {
					if (!selection) return false;
					if (!selection.entrant) return false;
					if (!selection.entrant.id) return false;
					return playerEntrantIds.includes(selection.entrant.id);
				});
				if (playerSelection) {
					const character = playerSelection.character;
					if (!character) return;
					if (!character.name) return;

					characters[character.name] = (characters[character.name] || 0) + 1;
				}
			});
		});
	});

	const response = {
		player: {
			id: res.data?.player?.id,
			name: res.data?.player?.prefix
				? `${res.data.player.prefix} | ${res.data.player.gamerTag}`
				: res.data?.player?.gamerTag,
			image: res.data?.player?.user?.images?.[0]?.url,
			selection: {
				stages: playedStages,
				characters
			},
			achievements: {
				shutoutsDealt
			}
		},
		tournament: {
			perMonth: tournamentsPerMonth,
			mostAttendees: tournamentWithMostAttendees,
			total: tournamentsThisYear.length,
			online: onlineTournaments.length,
			offline: offlineTournaments.length
		},
		set: {
			total: resSets1stPage.data?.player?.sets?.pageInfo?.total ?? 0,
			setsOnStream,
			recurringOpponents: sortedRecurringOpponents
		}
	};

	// Save the player's data in the KV store
	// NOTE: I have `eviction` set to `true` so there is no need to set an expiration time
	// More info: https://upstash.com/docs/redis/features/eviction
	await redis.set(REDIS_KEY, JSON.stringify(response));

	// Return the response
	return json(response);
};
