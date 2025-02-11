<script lang="ts">
	import { goto } from '$app/navigation';
	import Combobox from '$lib/components/Combobox/Combobox.svelte';
	import { useDebounce } from '$lib/runes/useDebounce.svelte';

	const { data } = $props();

	const debounceSearch = useDebounce('', 250);
	const debounceResults = useDebounce(data.players, 250);

	const onComboboxInput = (event: Event) => {
		const v = (event.target as HTMLInputElement).value;
		debounceSearch.update(v);
	};

	$effect(() => {
		goto(`/?gamerTag=${debounceSearch.value}`, {
			replaceState: true,
			keepFocus: true
		});
	});

	// Update the debounced results when the data changes
	$effect(() => {
		if (debounceResults.value.length !== data.players.length && !debounceResults.loading) {
			debounceResults.update(data.players);
		}
	});

	$effect(() => {
		if (selected) {
			void goto(`/player/${selected.id}`);
		}
	});

	type Player = (typeof data.players)[number];

	let value = $state('');
	let selected = $state<Player>();

	const makeText = (player: Player) =>
		`${player.prefix ? player.prefix + ' | ' : ''}${player.gamerTag}`;
</script>

{#snippet ComboboxOption(option: Player, idx: number)}
	{#await data.images then images}
		<li
			role="option"
			tabindex={-1}
			data-text={makeText(option)}
			data-value={option.id}
			aria-selected={selected?.id === option.id}
			aria-disabled={false}
		>
			{#if images}
				<img
					src={images[idx]}
					alt={''}
					width={32}
					height={32}
					style="border-radius: 0.5rem; object-fit: cover; object-position: center; margin-right: 0.5rem;"
				/>
			{/if}
			{makeText(option)}
		</li>
	{/await}
{/snippet}

<main class="container">
	<section id="hero">
		<div class="dialog">
			<div class="dialog-content">
				<h1>Your smash year in review</h1>
				<p>
					Unwrap your journey through the tournaments, battles, and triumphs that made your Smash
					year unforgettable.
				</p>

				<Combobox
					bind:value
					bind:selected
					option={ComboboxOption}
					options={debounceResults.value}
					getText={(t) => (t ? `${t.prefix ? t.prefix + ' | ' : ''}${t.gamerTag}` : 'N/A')}
					getValue={(t) => String(t?.id)}
					placeholder="Enter your start.gg username"
					oninput={onComboboxInput}
				/>

				<span class="separator" aria-hidden="true">Or</span>

				<a class="startgg-oauth" href="http://start.gg/oath/...">
					<svg
						width="24"
						height="24"
						viewBox="0 0 40 40"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M1.25 20h7.5A1.25 1.25 0 0 0 10 18.75v-7.5A1.25 1.25 0 0 1 11.25 10h27.5A1.25 1.25 0 0 0 40 8.75V1.25A1.25 1.25 0 0 0 38.75 0H10A10 10 0 0 0 0 10v8.75A1.25 1.25 0 0 0 1.25 20Z"
							fill="#3f80ff"
						></path>
						<path
							d="M38.75 20h-7.5A1.25 1.25 0 0 0 30 21.25v7.5A1.25 1.25 0 0 1 28.75 30H1.25A1.25 1.25 0 0 0 0 31.25v7.5A1.25 1.25 0 0 0 1.25 40H30A10 10 0 0 0 40 30V21.25A1.25 1.25 0 0 0 38.75 20Z"
							fill="#ff2768"
						></path>
					</svg>
					<span class="desktop-only">Continue with my start.gg account</span>
					<span class="mobile-only"> Continue with start.gg </span>
				</a>
			</div>
		</div>
	</section>
</main>

<style>
	#hero {
		display: flex;
		align-items: center;
		justify-content: center;

		height: 80svh;
	}

	.dialog {
		max-width: 50rem; /* 800px */
		width: 100%;
		border-radius: 0.5rem;
		background-color: hsl(var(--color-background-surface));
		border: 2px solid hsl(var(--color-border));

		color: hsl(var(--color-text-muted-on-surface));

		.dialog-content {
			padding: 2rem;
			display: grid;
			gap: 1.5rem;

			h1 {
				font-family: var(--font-headline);
				font-size: 2.25rem; /* 36px */
				line-height: 3.375rem; /* 54px */
				font-weight: 800;
				color: white;
			}

			p {
				max-width: 33.5rem; /* 536px */
			}

			.separator {
				display: flex;
				align-items: center;
				text-align: center;
				color: hsl(var(--color-border));
				text-transform: uppercase;

				&::before,
				&::after {
					content: '';
					flex: 1;
					border-bottom: 2px solid hsl(var(--color-border));
				}

				&:not(:empty)::before {
					margin-right: 0.5rem;
				}

				&:not(:empty)::after {
					margin-left: 0.5rem;
				}
			}

			.startgg-oauth {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 0.75rem;
				padding: 0 1.5rem;
				height: 3.5rem;
				border-radius: 0.5rem;
				background-color: hsl(var(--color-background-element));
			}
		}
	}

	.desktop-only {
		display: inline;
	}

	.mobile-only {
		display: none;
	}

	@media screen and (max-width: 768px) {
		.dialog {
			.dialog-content {
				padding: 1.5rem;
				gap: 1rem;

				h1 {
					font-size: 1.75rem; /* 28px */
					line-height: 2.625rem; /* 42px */
				}

				p {
					max-width: 30rem; /* 480px */
				}

				.startgg-oauth {
					height: 2.5rem;

					svg {
						width: 1.25rem;
						height: 1.25rem;
					}
				}
			}
		}

		.desktop-only {
			display: none;
		}

		.mobile-only {
			display: inline;
		}
	}
</style>
