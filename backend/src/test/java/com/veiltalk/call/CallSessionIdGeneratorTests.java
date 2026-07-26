package com.veiltalk.call;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class CallSessionIdGeneratorTests {

	@Test
	void generatesSameIdRegardlessOfCallerCalleeOrder() {
		UUID userA = UUID.randomUUID();
		UUID userB = UUID.randomUUID();

		UUID aCallsB = CallSessionIdGenerator.generate(userA, userB);
		UUID bCallsA = CallSessionIdGenerator.generate(userB, userA);

		assertThat(aCallsB).isEqualTo(bCallsA);
	}

	@Test
	void generatesDifferentIdsForDifferentPairs() {
		UUID userA = UUID.randomUUID();
		UUID userB = UUID.randomUUID();
		UUID userC = UUID.randomUUID();

		UUID pairAB = CallSessionIdGenerator.generate(userA, userB);
		UUID pairAC = CallSessionIdGenerator.generate(userA, userC);

		assertThat(pairAB).isNotEqualTo(pairAC);
	}

	@Test
	void isDeterministicAcrossRepeatedCalls() {
		UUID userA = UUID.randomUUID();
		UUID userB = UUID.randomUUID();

		UUID first = CallSessionIdGenerator.generate(userA, userB);
		UUID second = CallSessionIdGenerator.generate(userA, userB);

		assertThat(first).isEqualTo(second);
	}
}
