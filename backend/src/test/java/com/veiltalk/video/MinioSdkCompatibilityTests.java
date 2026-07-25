package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;

import io.minio.MinioAsyncClient;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class MinioSdkCompatibilityTests {

    @Test
    void sdkExposesPublicLowLevelMultipartOperationsForFollowingTasks() {
        Set<String> publicMethodNames = Arrays.stream(MinioAsyncClient.class.getMethods())
                .filter(method -> Modifier.isPublic(method.getModifiers()))
                .map(Method::getName)
                .collect(Collectors.toSet());

        assertThat(publicMethodNames).contains(
                "createMultipartUploadAsync",
                "uploadPartAsync",
                "completeMultipartUploadAsync",
                "abortMultipartUploadAsync");
    }
}
