const MUSIC_URL = "https://ia802609.us.archive.org/9/items/Free_20s_Jazz_Collection/Ambassadors_Me_And_The_Man_In_The_Moon.mp3";

var context = new AudioContext();
var source = context.createBufferSource();
var canvas;
var canvasContext;
var startTime;

addEventListener("DOMContentLoaded", initialize);
addEventListener("resize", resize);

function initialize() {
	canvas = document.querySelector("canvas");
	canvasContext = canvas.getContext("2d");
	resize();
	
	loadTrack(MUSIC_URL, function(buffer) {
		playSound(buffer);
	});
	
	// var tone = generateTone(44100, 2, 0.5, 440);
	// var buffer = context.createBuffer(1, tone.length, context.sampleRate);
	// buffer.copyToChannel(tone, 0);
	
	// var noise = generateWhiteNoise(44100, 2, 0.5, 440);
	// var buffer = context.createBuffer(1, noise.length, context.sampleRate);
	// buffer.copyToChannel(noise, 0);
	
	playSound(buffer);
}

function visualize(samples, flux, threshold, prunnedSpectralFlux, peakFreq) {
	canvasContext.clearRect(0, 0, canvas.width, canvas.height);
	var xScale = 128;
	var yScale = 100;
	plotSamples(samples, 1, context.currentTime - startTime, 0, xScale, yScale, "red");
	plotSamples(flux, 1024, context.currentTime - startTime, 0, xScale, yScale, "green");
	plotSamples(threshold, 1024, context.currentTime - startTime, 0, xScale, yScale, "purple");
	plotSamples(prunnedSpectralFlux, 1024, context.currentTime - startTime, 0, xScale, yScale, "blue");
	plotSamples(peakFreq, 1, 0, 250, 1, 1000, "orange", true);
	
	requestAnimationFrame(function() {
		visualize(samples, flux, threshold, prunnedSpectralFlux, peakFreq);
	});
}

function resize() {
	canvas.width = document.documentElement.clientWidth;
	canvas.height = document.documentElement.clientHeight;
}

function plotSamples(samples, resolution, offsetSeconds, yOffset, xScale, yScale, color, notCentered) {
	canvasContext.strokeStyle = color;
	canvasContext.beginPath();
	canvasContext.moveTo(0, canvas.height / 2 + yOffset);
	
	var y;
	var samplesPerPixel = xScale / resolution;
	
	var startSampleRaw = offsetSeconds * context.sampleRate / resolution;
	var startSample = Math.floor(startSampleRaw);
	var pixelDifference;
	
	if (samplesPerPixel < 1) {
		// Each sample is wider than a pixel, so map samples to pixels
		
		pixelDifference = (startSampleRaw - startSample) / samplesPerPixel;
		
		if (!notCentered) startSample -= Math.floor(canvas.width / 2 * samplesPerPixel);
		var endSample = startSample + canvas.width * samplesPerPixel;
		
		for (let sample = startSample; sample < endSample + 2; sample++) {
			var x = (sample - startSample) / samplesPerPixel - pixelDifference;
			y = -samples[sample] * yScale;
			canvasContext.lineTo(x, y + yOffset + canvas.height / 2);
		}
	} else {
		// Each pixel is wider than a sample, so map pixels to samples
		
		startSample -= startSample % samplesPerPixel;
		
		pixelDifference = (startSampleRaw - startSample) / samplesPerPixel;
		
		if (!notCentered) startSample -= Math.floor(canvas.width / 2 * samplesPerPixel);
		
		for (let screenX = 0; screenX < canvas.width; screenX++) {
			var sampleIndex = Math.floor(screenX * samplesPerPixel) + startSample;
			y = -samples[sampleIndex] * yScale;
			canvasContext.lineTo(screenX - pixelDifference, y + yOffset + canvas.height / 2);
		}
	}
	canvasContext.stroke();
	
	// Draw playhead
	canvasContext.strokeStyle = "black";
	canvasContext.beginPath();
	canvasContext.moveTo(canvas.width / 2, 0);
	canvasContext.lineTo(canvas.width / 2, canvas.height);
	canvasContext.stroke();
}

function playSound(samples) {
	var buffer;
	
	if (samples instanceof AudioBuffer) {
		//buffer = samples;
	} else {
		//buffer = context.createBuffer(1, samples.length, context.sampleRate);
		//buffer.copyToChannel(samples, 0);
	}
	
	// Convert audio signal to mono by combining channels
	// if (samples.numberOfChannels > 1) {
	// 	samples = stereoToMono(samples);
	// }
	
	// Get a buffer of samples from the left channel
	var bufferSamples = samples.getChannelData(0);
	
	const THRESHOLD_WINDOW_SIZE = 10;
	const MULTIPLIER            = 1.5;
	const SAMPLE_SIZE           = 1024;
	const FFT2SIZE              = 1024;
	
	var fft  = new FFT(SAMPLE_SIZE, 44100);
	var fft2 = new FFT(FFT2SIZE,    44100 / SAMPLE_SIZE);
	var spectrum     = new Float32Array(SAMPLE_SIZE / 2);
	var prevSpectrum = new Float32Array(SAMPLE_SIZE / 2);
	var prunnedSpectralFlux = [];
	var splitSamples = [];
	var spectralFlux = [];
	var threshold    = [];
	var peaks        = [];
	var peakFreq     = [];
	
	// Split samples into arrays of 1024
	for (let i = 0; i < bufferSamples.length; i += SAMPLE_SIZE) {
		splitSamples.push(bufferSamples.slice(i, i + SAMPLE_SIZE));
	}
	
	// Calculate a spectral flux value for each sample range in the song
	for (let i = 0; i < splitSamples.length; i++) {
		// Samples must fill the full size to ensure a power of two for the FFT
		if (splitSamples[i].length !== SAMPLE_SIZE) break;
		
		// Copy the current spectrum values into the previous
		for (let j = 0; j < spectrum.length; j++) {
			prevSpectrum[j] = spectrum[j];
		}
		
		// Apply the Hamming function to clean up the audio signal
		//var windowFunction = new WindowFunction(WindowFunction.HAMMING);
		//var result = windowFunction.process(length, index);
		
		// Update the current spectrum with the FFT bins for this sample range
		fft.forward(splitSamples[i]);
		spectrum = fft.spectrum;
		
		// Spectral flux is the sum of all increasing (positive) differences in each bin and its corresponding bin from the previous sample
		var flux = 0;
		
		// Caring only about rising matching bin deltas between this and the previous spectrum, sum all positive deltas to calculate total flux
		for (let bin = 0; bin < spectrum.length; bin++) {
			flux += Math.max(0, spectrum[bin] - prevSpectrum[bin]);
		}
		
		// Save the calculated flux for this sample range
		spectralFlux.push(flux);
	}
	
	// Calculate threshold values by averaging the range of flux values
	for (let i = 0; i < spectralFlux.length; i++) {
		// Determine the start and end indexes of the spectral flux for this iteration's window range
		var start = Math.max(0, i - THRESHOLD_WINDOW_SIZE);
		var end = Math.min(spectralFlux.length - 1, i + THRESHOLD_WINDOW_SIZE);
		
		// Sum all the spectral flux values in this range
		var sum = 0;
		for (let flux = start; flux <= end; flux++) {
			sum += spectralFlux[flux];
		}
		
		// Save the calculated threshold value for this averaging window range
		threshold.push(sum / (end - start) * MULTIPLIER);
	}
	
	// Calculate pruned flux values where the spectral flux exceeds the averaged threshold
	for (let i = 0; i < threshold.length; i++) {
		// Save either zero or the difference from threshold to flux if positive
		prunnedSpectralFlux.push(Math.max(0, spectralFlux[i] - threshold[i]));
	}
	
	// Remove all but the peaks of pruned spectral flux values, setting all else to zero
	for (let i = 0; i < prunnedSpectralFlux.length - 1; i++) {
		if (prunnedSpectralFlux[i] > prunnedSpectralFlux[i + 1]) {
			// This is higher than the next value, so save it
			peaks.push(prunnedSpectralFlux[i]);
		} else {
			// This is lower than the next value, so drop it to zero
			peaks.push(0);
		}
	}
	
	// Perform a fourier transform on the pruned flux peaks to find the frequencies of onsets (in theory, but this idea is probably wrong)
	for (let i = 0; i < peaks.length; i += FFT2SIZE) {
		// Slice the pruned flux peaks into blocks of a power of two for the FFT algorithm
		var splitPeaks = peaks.slice(i, i + FFT2SIZE);
		
		// On the last block, stop if it's not the correct size
		if (splitPeaks.length !== FFT2SIZE) break;
		
		// Perform a fourier transform on this block of flux peaks
		fft2.forward(splitPeaks);
		
		// Run through each bin of the resulting frequency-space spectrum
		for (let j = 0; j < fft2.spectrum.length; j++) {
			// Sum each bin's frequency value into the total amonst all blocks
			if (peakFreq[j]) {
				// Add to an existing value
				peakFreq[j] += fft2.spectrum[j];
			} else {
				// Set a value because it has not yet been added to the array
				peakFreq[j] = fft2.spectrum[j];
			}
		}
	}
	
	source.connect(context.destination);
	source.buffer = samples;
	source.start();
	startTime = context.currentTime;
	
	visualize(bufferSamples, spectralFlux, threshold, peaks, peakFreq);
}

function stereoToMono(buffer) {
	var left = buffer.getChannelData(0);
	var right = buffer.getChannelData(1);
	
	var monoData = new Float32Array(left.length);
	for (let sample in monoData) {
		monoData[sample] = (left[sample] + right[sample]) / 2;
	}
	
	var monoBuffer = context.createBuffer(1, monoData.length, context.sampleRate);
	monoBuffer.copyToChannel(monoData, 0);
	return monoBuffer;
}

function generateTone(sampleRate, duration, loudness, frequency) {
	var samples = new Float32Array(sampleRate * duration);
	
	for (let i in samples) {
		samples[i] = Math.sin(2 * Math.PI * i * frequency / sampleRate) * loudness;
	}
	
	return samples;
}

function generateWhiteNoise(sampleRate, duration, loudness) {
	var samples = new Float32Array(sampleRate * duration);
	
	for (let i in samples) {
		samples[i] = (Math.random() * 2 - 1) * loudness;
	}
	
	return samples;
}

function loadTrack(url, callback) {
	var request = new XMLHttpRequest();
	request.open("GET", url, true);
	request.responseType = "arraybuffer";
	request.onload = function() {
		context.decodeAudioData(request.response, callback);
	};
	request.send();
}
